import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, authorize, protect } from '../middleware/auth';
import {
  createRecoveryPackage,
  isSanitizedRecoveryEnvironment,
  recoveryPackagePath,
  stageAndPromoteRecovery,
  storeUploadedRecoveryPackage,
  validateRecoveryPackage,
} from '../services/systemRecoveryEngine';
import {
  assertRestoreAuthorization,
  assertStrongBackupPassphrase,
  packageExpired,
  RECOVERY_APPROVAL_MS,
  RECOVERY_FRESHNESS_MS,
  RECOVERY_RETENTION_MS,
  RecoveryPackageType,
} from '../services/systemRecoveryPolicy';
import {
  acquireRecoveryOperation,
  getRecoveryRuntimeState,
  RECOVERY_ROOT,
  releaseRecoveryOperation,
  setRecoveryRuntimeState,
  waitForActiveWrites,
} from '../services/recoveryRuntime';

const router = express.Router();
const prisma = new PrismaClient();
const uploadTemp = path.join(RECOVERY_ROOT, 'upload-temp');
fs.mkdirSync(uploadTemp, { recursive: true, mode: 0o700 });
const upload = multer({
  dest: uploadTemp,
  limits: { files: 1, fileSize: 50 * 1024 * 1024 * 1024 },
});

router.get('/environment', protect, (_req, res) => {
  res.json({ success: true, data: { sanitizedEnvironment: isSanitizedRecoveryEnvironment() } });
});

router.use(protect, authorize('ADMIN'));

const verifyAdminPassword = async (req: AuthRequest) => {
  const password = String(req.body?.adminPassword || '');
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } });
  if (!user || !password || !await bcrypt.compare(password, user.password)) {
    throw Object.assign(new Error('Current administrator password is incorrect.'), { code: 'ADMIN_PASSWORD_INCORRECT', status: 403 });
  }
};

const audit = (operationId: string | null, actorId: string | null, eventType: string, packageChecksum?: string | null, details?: object) =>
  prisma.recoveryAuditEvent.create({
    data: { operationId, actorId, eventType, packageChecksum, details },
  });

const respondError = (res: Response, error: any) => {
  const status = Number(error?.status) || (String(error?.code || '').includes('PASSWORD') ? 400 : 400);
  res.status(status).json({ success: false, error: error?.code || 'SYSTEM_RECOVERY_FAILED', message: error?.message || 'System recovery action failed.' });
};

const serializeOperation = (operation: any) => ({
  ...operation,
  size: operation.size == null ? null : Number(operation.size),
  storageName: undefined,
});

router.get('/', async (req: AuthRequest, res) => {
  const [operations, latestDownloaded] = await Promise.all([
    prisma.recoveryOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, username: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true, username: true } },
      },
    }),
    prisma.recoveryOperation.findFirst({
      where: { packageType: 'COMPLETE', downloadedAt: { not: null } },
      orderBy: { downloadedAt: 'desc' },
      select: { downloadedAt: true },
    }),
  ]);
  const downloadedAt = latestDownloaded?.downloadedAt || null;
  res.json({
    success: true,
    data: {
      operations: operations.map(serializeOperation),
      runtime: getRecoveryRuntimeState(),
      sanitizedEnvironment: isSanitizedRecoveryEnvironment(),
      sanitizedRestoreEnabled: process.env.NODE_ENV !== 'production' && process.env.ALLOW_SANITIZED_RECOVERY === 'true',
      latestCompleteDownloadAt: downloadedAt,
      stale: !downloadedAt || Date.now() - downloadedAt.getTime() >= RECOVERY_FRESHNESS_MS,
      retentionHours: 24,
    },
  });
});

router.post('/backups', async (req: AuthRequest, res) => {
  let lockAcquired = false;
  let backgroundStarted = false;
  try {
    await verifyAdminPassword(req);
    const packageType = String(req.body.packageType || '') as RecoveryPackageType;
    if (!['COMPLETE', 'SANITIZED_TEST'].includes(packageType)) throw Object.assign(new Error('Invalid package type.'), { code: 'INVALID_PACKAGE_TYPE' });
    const passphrase = assertStrongBackupPassphrase(req.body.passphrase);
    if (!acquireRecoveryOperation()) return res.status(409).json({ success: false, error: 'RECOVERY_OPERATION_IN_PROGRESS' });
    lockAcquired = true;
    const operation = await prisma.recoveryOperation.create({
      data: {
        packageType,
        source: 'CREATED',
        status: 'CREATING',
        progress: 0,
        createdById: req.user!.id,
        expiresAt: new Date(Date.now() + RECOVERY_RETENTION_MS),
      },
    });
    await audit(operation.id, req.user!.id, 'RECOVERY_BACKUP_REQUESTED', null, { packageType });
    res.status(202).json({ success: true, data: serializeOperation(operation) });
    backgroundStarted = true;
    setImmediate(async () => {
      let snapshotReleased = false;
      try {
        setRecoveryRuntimeState('READ_ONLY', operation.id, 'A consistent recovery snapshot is being captured.');
        await waitForActiveWrites();
        const result = await createRecoveryPackage({
          operationId: operation.id,
          packageType,
          passphrase,
          prisma,
          onProgress: async (progress) => {
            if (progress >= 55 && !snapshotReleased) {
              snapshotReleased = true;
              setRecoveryRuntimeState('NORMAL');
            }
            await prisma.recoveryOperation.update({ where: { id: operation.id }, data: { progress } });
          },
        });
        if (!snapshotReleased) setRecoveryRuntimeState('NORMAL');
        const readyAt = new Date();
        await prisma.recoveryOperation.update({
          where: { id: operation.id },
          data: {
            status: 'READY',
            progress: 100,
            storageName: result.storageName,
            originalName: `sabalan-${packageType.toLowerCase()}-${readyAt.toISOString().replace(/[:.]/g, '-')}.sabrec`,
            encryptedSha256: result.sha256,
            size: BigInt(result.size),
            sourceAppVersion: result.manifest.appVersion,
            sourceCommit: result.manifest.commit,
            sourcePostgresVersion: result.manifest.postgresVersion,
            compatibility: { compatible: true, reasons: [] },
            readyAt,
          },
        });
        await audit(operation.id, req.user!.id, 'RECOVERY_BACKUP_READY', result.sha256, { packageType, size: result.size });
      } catch (error: any) {
        setRecoveryRuntimeState('NORMAL');
        await prisma.recoveryOperation.update({
          where: { id: operation.id },
          data: { status: 'FAILED', errorCode: error?.code || 'BACKUP_CREATION_FAILED', errorMessage: error?.message || 'Backup creation failed.' },
        }).catch(() => undefined);
        await audit(operation.id, req.user!.id, 'RECOVERY_BACKUP_FAILED', null, { code: error?.code, message: error?.message }).catch(() => undefined);
      } finally {
        releaseRecoveryOperation();
      }
    });
  } catch (error) {
    if (lockAcquired && !backgroundStarted) releaseRecoveryOperation();
    respondError(res, error);
  }
});

router.post('/:id/download', async (req: AuthRequest, res) => {
  try {
    await verifyAdminPassword(req);
    const operation = await prisma.recoveryOperation.findUnique({ where: { id: req.params.id } });
    if (!operation || operation.status !== 'READY' || !operation.storageName) return res.status(404).json({ success: false, error: 'RECOVERY_PACKAGE_NOT_READY' });
    if (packageExpired(operation.expiresAt)) return res.status(410).json({ success: false, error: 'RECOVERY_PACKAGE_EXPIRED' });
    const filePath = recoveryPackagePath(operation.source, operation.storageName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'RECOVERY_PACKAGE_FILE_MISSING' });
    res.download(filePath, operation.originalName || 'sabalan-recovery.sabrec', async (error) => {
      if (error) return;
      const downloadedAt = new Date();
      await prisma.recoveryOperation.update({ where: { id: operation.id }, data: { downloadedAt } });
      await audit(operation.id, req.user!.id, 'RECOVERY_BACKUP_DOWNLOADED', operation.encryptedSha256);
    });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/uploads', upload.single('file'), async (req: AuthRequest, res) => {
  const temporaryPath = req.file?.path;
  let operationId: string | null = null;
  let storedPath: string | null = null;
  let lockAcquired = false;
  let backgroundStarted = false;
  try {
    await verifyAdminPassword(req);
    if (!req.file) throw Object.assign(new Error('Recovery package file is required.'), { code: 'RECOVERY_FILE_REQUIRED' });
    const passphrase = assertStrongBackupPassphrase(req.body.passphrase);
    if (!acquireRecoveryOperation()) {
      if (temporaryPath) await fs.promises.rm(temporaryPath, { force: true });
      return res.status(409).json({ success: false, error: 'RECOVERY_OPERATION_IN_PROGRESS' });
    }
    lockAcquired = true;
    const operation = await prisma.recoveryOperation.create({
      data: {
        packageType: 'COMPLETE',
        source: 'UPLOADED',
        status: 'VALIDATING',
        progress: 10,
        originalName: path.basename(req.file.originalname),
        createdById: req.user!.id,
        expiresAt: new Date(Date.now() + RECOVERY_RETENTION_MS),
      },
    });
    operationId = operation.id;
    const stored = await storeUploadedRecoveryPackage(req.file.path, operation.id);
    storedPath = stored.destination;
    const uploaded = await prisma.recoveryOperation.update({
      where: { id: operation.id },
      data: {
        storageName: stored.storageName,
        encryptedSha256: stored.sha256,
        size: BigInt(stored.size),
        progress: 20,
      },
    });
    await audit(operation.id, req.user!.id, 'RECOVERY_PACKAGE_UPLOADED', stored.sha256, { size: stored.size });
    res.status(202).json({ success: true, data: serializeOperation(uploaded) });
    backgroundStarted = true;
    setImmediate(async () => {
      try {
        const validation = await validateRecoveryPackage({ sourcePath: stored.destination, passphrase, prisma });
        if (validation.manifest.packageType === 'SANITIZED_TEST' && (process.env.NODE_ENV === 'production' || process.env.ALLOW_SANITIZED_RECOVERY !== 'true')) {
          throw Object.assign(new Error('Sanitized test restore is disabled in this environment.'), { code: 'SANITIZED_RESTORE_DISABLED' });
        }
        const status = validation.compatibility.compatible ? 'VALIDATED' : 'INCOMPATIBLE';
        await prisma.recoveryOperation.update({
          where: { id: operation.id },
          data: {
            packageType: validation.manifest.packageType,
            status,
            progress: 100,
            formatVersion: validation.manifest.formatVersion,
            sourceAppVersion: validation.manifest.appVersion,
            sourceCommit: validation.manifest.commit,
            sourcePostgresVersion: validation.manifest.postgresVersion,
            compatibility: validation.compatibility,
            validatedAt: new Date(),
          },
        });
        await audit(operation.id, req.user!.id, 'RECOVERY_PACKAGE_VALIDATED', stored.sha256, { packageType: validation.manifest.packageType, compatibility: validation.compatibility });
      } catch (error: any) {
        await fs.promises.rm(stored.destination, { force: true }).catch(() => undefined);
        await prisma.recoveryOperation.update({
          where: { id: operation.id },
          data: { status: 'FAILED', progress: 100, errorCode: error?.code || 'RECOVERY_VALIDATION_FAILED', errorMessage: error?.message || 'Recovery validation failed.', storageName: null },
        }).catch(() => undefined);
        await audit(operation.id, req.user!.id, 'RECOVERY_PACKAGE_VALIDATION_FAILED', stored.sha256, { code: error?.code, message: error?.message }).catch(() => undefined);
      } finally {
        releaseRecoveryOperation();
      }
    });
  } catch (error: any) {
    if (backgroundStarted) return;
    if (temporaryPath) await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (storedPath) await fs.promises.rm(storedPath, { force: true }).catch(() => undefined);
    if (operationId) {
      await prisma.recoveryOperation.update({
        where: { id: operationId },
        data: { status: 'FAILED', errorCode: error?.code || 'RECOVERY_VALIDATION_FAILED', errorMessage: error?.message || 'Recovery validation failed.', storageName: null },
      }).catch(() => undefined);
      await audit(operationId, req.user!.id, 'RECOVERY_PACKAGE_VALIDATION_FAILED', null, { code: error?.code, message: error?.message }).catch(() => undefined);
    }
    if (lockAcquired) releaseRecoveryOperation();
    respondError(res, error);
  }
});

router.post('/:id/approve', async (req: AuthRequest, res) => {
  try {
    await verifyAdminPassword(req);
    const operation = await prisma.recoveryOperation.findUnique({ where: { id: req.params.id } });
    if (!operation || !['VALIDATED', 'APPROVED'].includes(operation.status)) return res.status(404).json({ success: false, error: 'VALIDATED_RECOVERY_PACKAGE_NOT_FOUND' });
    if (operation.createdById === req.user!.id) return res.status(409).json({ success: false, error: 'RESTORE_SELF_APPROVAL_FORBIDDEN' });
    const approvalExpiresAt = new Date(Date.now() + RECOVERY_APPROVAL_MS);
    const updated = await prisma.recoveryOperation.update({
      where: { id: operation.id },
      data: { approvedById: req.user!.id, approvalExpiresAt, status: 'APPROVED' },
    });
    await audit(operation.id, req.user!.id, 'RECOVERY_RESTORE_APPROVED', operation.encryptedSha256, { approvalExpiresAt });
    res.json({ success: true, data: serializeOperation(updated) });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/restore', async (req: AuthRequest, res) => {
  let lockAcquired = false;
  let backgroundStarted = false;
  try {
    await verifyAdminPassword(req);
    const passphrase = assertStrongBackupPassphrase(req.body.passphrase);
    const operation = await prisma.recoveryOperation.findUnique({ where: { id: req.params.id } });
    if (!operation || !['VALIDATED', 'APPROVED'].includes(operation.status) || !operation.storageName || !operation.encryptedSha256) {
      return res.status(404).json({ success: false, error: 'RESTORABLE_RECOVERY_PACKAGE_NOT_FOUND' });
    }
    if (packageExpired(operation.expiresAt)) return res.status(410).json({ success: false, error: 'RECOVERY_PACKAGE_EXPIRED' });
    const activeAdminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
    const authorization = assertRestoreAuthorization({
      actorId: req.user!.id,
      activeAdminCount,
      approvedById: operation.approvedById,
      approvalExpiresAt: operation.approvalExpiresAt,
      breakGlassReason: req.body.breakGlassReason,
      confirmationPhrase: req.body.confirmationPhrase,
    });
    const sourcePath = recoveryPackagePath(operation.source, operation.storageName);
    const validation = await validateRecoveryPackage({ sourcePath, passphrase, prisma });
    if (!validation.compatibility.compatible) return res.status(409).json({ success: false, error: 'RECOVERY_PACKAGE_INCOMPATIBLE', data: validation.compatibility });
    if (!acquireRecoveryOperation()) return res.status(409).json({ success: false, error: 'RECOVERY_OPERATION_IN_PROGRESS' });
    lockAcquired = true;
    const bootstrapPassword = operation.packageType === 'SANITIZED_TEST'
      ? `Local-${crypto.randomBytes(9).toString('base64url')}9`
      : undefined;
    await prisma.recoveryOperation.update({
      where: { id: operation.id },
      data: {
        status: 'RESTORING',
        progress: 0,
        restoreStartedAt: new Date(),
        breakGlassReason: authorization.mode === 'BREAK_GLASS' ? String(req.body.breakGlassReason).trim() : null,
      },
    });
    const actor = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { firstName: true, lastName: true, username: true } });
    const actorDisplay = actor ? `${actor.firstName} ${actor.lastName} (${actor.username})` : req.user!.id;
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
    if (admins.length) {
      await prisma.securityNotification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: 'SYSTEM_RECOVERY_STARTED',
          title: 'بازیابی کامل سامانه آغاز شد',
          message: `بازیابی توسط ${actorDisplay} آغاز شد.`,
          referenceId: operation.id,
        })),
      });
    }
    await audit(operation.id, req.user!.id, 'RECOVERY_RESTORE_STARTED', operation.encryptedSha256, { authorizationMode: authorization.mode });
    setRecoveryRuntimeState('MAINTENANCE', operation.id, 'A validated system recovery is being promoted.');
    res.status(202).json({
      success: true,
      data: {
        operationId: operation.id,
        restarting: true,
        bootstrapAdmin: bootstrapPassword ? { username: 'local_recovery_admin', temporaryPassword: bootstrapPassword } : null,
      },
    });
    backgroundStarted = true;
    setImmediate(async () => {
      try {
        await waitForActiveWrites();
        await stageAndPromoteRecovery({
          operationId: operation.id,
          sourcePath,
          passphrase,
          packageType: operation.packageType as RecoveryPackageType,
          checksum: operation.encryptedSha256!,
          actorId: req.user!.id,
          actorDisplay,
          authorizationMode: authorization.mode,
          approvedById: operation.approvedById,
          approvalExpiresAt: operation.approvalExpiresAt,
          breakGlassReason: authorization.mode === 'BREAK_GLASS' ? String(req.body.breakGlassReason).trim() : null,
          bootstrapPassword,
          onProgress: async (progress) => {
            if (progress <= 70) await prisma.recoveryOperation.update({ where: { id: operation.id }, data: { progress } });
          },
        });
        setTimeout(() => process.exit(0), 500).unref();
      } catch (error: any) {
        setRecoveryRuntimeState('NORMAL');
        releaseRecoveryOperation();
        await prisma.recoveryOperation.update({
          where: { id: operation.id },
          data: { status: 'FAILED', errorCode: error?.code || 'RESTORE_FAILED', errorMessage: error?.message || 'Restore failed.' },
        }).catch(() => undefined);
        await audit(operation.id, req.user!.id, 'RECOVERY_RESTORE_FAILED', operation.encryptedSha256, { code: error?.code, message: error?.message }).catch(() => undefined);
      }
    });
  } catch (error) {
    if (lockAcquired && !backgroundStarted) {
      releaseRecoveryOperation();
      setRecoveryRuntimeState('NORMAL');
    }
    respondError(res, error);
  }
});

export default router;
