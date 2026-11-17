import { disconnectDatabase, prisma } from '../lib/prisma';
import { assertProtectedRoleCheckpointBoundary, configuredProtectedDatabaseRoleRecovery } from '../services/protectedDatabaseRoleRecovery';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';
import { assertRuntimeControlOwnership } from '../services/runtimeControlOwnership';
import { executeBackupRequest, OWNER_BACKUP_REQUESTED } from '../services/systemRecoveryBackupRequest';
import { readSystemRecoveryOwnerRequest } from '../services/systemRecoveryOwnerInput';
import { readSealedRecoveryOwnerInput } from '../services/systemRecoveryOwnerInput';
import { readRestoreJournal, recoveryPackagePath, stageAndPromoteRecovery, validateRecoveryPackage } from '../services/systemRecoveryEngine';
import { OWNER_HANDOFF_REQUESTED } from '../services/systemRecoveryOwnerHandoff';
import { assertRestoreAuthorization, packageExpired } from '../services/systemRecoveryPolicy';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { assertRecoveryAllocationContinuity, captureRecoveryAllocationAuthority, readRecoveryAllocationAuthority,
  recoveryOwnerReceiptPath, type RecoveryRuntimeProof } from '../services/systemRecoveryAllocationAuthority';

const rejected = () => new Error('SYSTEM_RECOVERY_OWNER_ADMISSION_REJECTED');

async function main() {
  assertRuntimeControlOwnership();
  const scope = configuredProtectedDatabaseRoleRecovery();
  if (process.env.BACKEND_RUNTIME_ROLE !== 'control' || !scope || process.stdin.isTTY) throw rejected();
  const inputDeadline = setTimeout(() => process.stdin.destroy(new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID')), 10_000);
  const args = process.argv.slice(2);
  const sealed = args[0] === '--sealed'
    ? await readSealedRecoveryOwnerInput(args, process.stdin, process.env.DEPLOYMENT_ID).finally(() => clearTimeout(inputDeadline))
    : null;
  const legacy = sealed ? null : await readSystemRecoveryOwnerRequest(args, process.stdin, process.env.DEPLOYMENT_ID)
    .finally(() => clearTimeout(inputDeadline));
  const operationId = sealed?.request.operationId || legacy!.operationId;
  const deploymentId = sealed?.deploymentId || legacy!.deploymentId;
  const passphrase = sealed?.request.passphrase || legacy!.passphrase;
  const restore = sealed?.request.action === 'RESTORE';
  const checkpoint = restore ? JSON.parse(await fs.readFile(path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json'), 'utf8')) : null;
  if (restore && (checkpoint?.deploymentId !== deploymentId || !checkpoint.localVerified || !checkpoint.remoteVerified
    || !/^[a-f0-9]{64}$/.test(checkpoint.checksum || ''))) throw rejected();

  const advisoryApplicationName = 'sabalan-lock-' + deploymentId;
  const assertBoundary = async () => {
    assertRuntimeControlOwnership();
    await assertProtectedRoleCheckpointBoundary({
      prisma, coordinationDir: RECOVERY_COORDINATION_DIR, id: deploymentId,
      phase: restore ? 'MUTATION_STARTED' : 'SERVICES_DRAINED', checksum: checkpoint?.checksum,
    });
    const journal = await readRestoreJournal();
    if (journal && (!restore || journal.operationId !== operationId)) throw rejected();
    const [database] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
      SELECT current_database() = ${scope.source} AND r.rolsuper AND r.rolcanlogin
        AND current_user = session_user AND d.datdba = r.oid
        AND EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid)
          WHERE a.application_name = ${advisoryApplicationName} AND a.datname = 'postgres'
            AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
            AND l.classid = 0 AND l.objid = 741936425 AND l.objsubid = 1)
        AND NOT EXISTS (SELECT FROM pg_stat_activity
          WHERE datname = current_database() AND usename = ${scope.roles.runtime})
        AS admitted
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
      WHERE r.rolname = session_user
    `;
    if (database?.admitted !== true) throw rejected();
  };

  await assertBoundary();
  const claim = await prisma.$transaction(async tx => {
    const operation = await tx.recoveryOperation.findUnique({
      where: { id: operationId },
    });
    const actorId = sealed?.request.actorId || operation?.createdById;
    const actor = actorId && await tx.user.findUnique({ where: { id: actorId } });
    if (!operation || !actor || actor.role !== 'ADMIN' || !actor.isActive || actor.erasedAt || packageExpired(operation.expiresAt)) throw rejected();
    let authorization: ReturnType<typeof assertRestoreAuthorization> | undefined;
    if (sealed) {
      const request = sealed.request;
      const events = await tx.recoveryAuditEvent.findMany({ where: { operationId, actorId,
        eventType: OWNER_HANDOFF_REQUESTED }, select: { details: true } });
      if (events.filter(event => {
        const details = event.details as any;
        return details?.requestId === request.requestId && details.sealedSha256 === sealed.sealedSha256
          && details.action === request.action && details.packageType === request.packageType;
      }).length !== 1 || operation.packageType !== request.packageType) throw rejected();
      if (restore) {
        if (operation.encryptedSha256 !== request.checksum || !operation.storageName
          || operation.approvedById !== (request.approvedById || null)
          || (operation.approvalExpiresAt?.toISOString() || null) !== (request.approvalExpiresAt || null)) throw rejected();
        if (operation.approvedById) {
          const approver = await tx.user.findUnique({ where: { id: operation.approvedById } });
          if (!approver || approver.role !== 'ADMIN' || !approver.isActive || approver.erasedAt) throw rejected();
        }
        authorization = assertRestoreAuthorization({ actorId: actor.id,
          activeAdminCount: await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } }),
          approvedById: operation.approvedById, approvalExpiresAt: operation.approvalExpiresAt,
          confirmationPhrase: request.confirmationPhrase, breakGlassReason: request.breakGlassReason });
      } else if (operation.createdById !== actor.id || operation.source !== 'CREATED') throw rejected();
    } else {
      const requested = await tx.recoveryAuditEvent.count({ where: { operationId, actorId: actor.id, eventType: OWNER_BACKUP_REQUESTED } });
      const handedOff = await tx.recoveryAuditEvent.count({ where: { operationId, eventType: OWNER_HANDOFF_REQUESTED } });
      if (requested !== 1 || handedOff !== 0 || operation.packageType !== 'COMPLETE' || operation.source !== 'CREATED') throw rejected();
    }
    const claimed = await tx.recoveryOperation.updateMany({
      where: {
        id: operationId, status: restore ? 'RESTORING' : 'CREATING', progress: 0, expiresAt: { gt: new Date() },
      },
      data: { progress: 1 },
    });
    if (claimed.count !== 1) throw rejected();
    return { operation, actorId: actor.id, actorDisplay: `${actor.firstName} ${actor.lastName} (${actor.username})`, authorization };
  }, { isolationLevel: 'Serializable' });

  try {
    if (restore) {
      const request = sealed!.request;
      const operation = claim.operation;
      const sourcePath = recoveryPackagePath(operation.source, operation.storageName!);
      const validation = await validateRecoveryPackage({ sourcePath, expectedChecksum: request.checksum, passphrase, prisma });
      if (!validation.compatibility.compatible || validation.manifest.packageType !== request.packageType) throw rejected();
      const runtimeBefore = JSON.parse(process.env.SYSTEM_RECOVERY_RUNTIME_BEFORE || 'null') as RecoveryRuntimeProof;
      const allocation = captureRecoveryAllocationAuthority(await readRecoveryAllocationAuthority(prisma), runtimeBefore);
      const result = await stageAndPromoteRecovery({ operationId, sourcePath, passphrase,
        packageType: request.packageType, checksum: request.checksum!, actorId: claim.actorId,
        actorDisplay: claim.actorDisplay, authorizationMode: claim.authorization!.mode,
        approvedById: request.approvedById, approvalExpiresAt: request.approvalExpiresAt ? new Date(request.approvalExpiresAt) : null,
        breakGlassReason: request.breakGlassReason, bootstrapPassword: request.bootstrapPassword,
        applicationRecoveryRoles: { ...scope, assertBoundary, prepareStage: async stage => {
          await assertBoundary();
          const live = await prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
          if (!live || live.activeKey !== 'production' || live.leaseToken !== process.env.DEPLOYMENT_LEASE_TOKEN) throw rejected();
          await stage.deploymentOperation.updateMany({ where: { activeKey: 'production' }, data: { activeKey: null } });
          const trusted = { ...live, checkpointJson: live.checkpointJson ?? Prisma.DbNull, reportJson: live.reportJson ?? Prisma.DbNull };
          await stage.deploymentOperation.upsert({ where: { id: live.id }, create: trusted, update: trusted });
        } },
        onProgress: async progress => {
          if (progress <= 70) {
            await assertBoundary();
            await prisma.recoveryOperation.update({ where: { id: operationId }, data: { progress } });
          }
        },
      });
      if (!result.promoted) throw rejected();
      if (!result.verifyPromotedRoles) throw rejected();
      await result.verifyPromotedRoles();
      await initializeSystemRecovery(prisma);
      if (await readRestoreJournal()) throw rejected();
      await assertBoundary();
      assertRecoveryAllocationContinuity(allocation, await readRecoveryAllocationAuthority(prisma), runtimeBefore);
      const receipt = await fs.open(recoveryOwnerReceiptPath(deploymentId), 'wx', 0o400);
      try {
        await receipt.writeFile(JSON.stringify({ format: 'sabalan-system-recovery-owner-completion/v1', deploymentId,
          operationId, ownerCompleted: true, allocation }) + '\n');
        await receipt.sync();
      } finally { await receipt.close(); }
    } else await executeBackupRequest(prisma, {
      operationId, actorId: claim.actorId, packageType: claim.operation.packageType as 'COMPLETE' | 'SANITIZED_TEST', passphrase,
      protectedDatabaseRoles: claim.operation.packageType === 'COMPLETE' ? scope : undefined,
      onProgress: async (progress) => {
        await assertBoundary();
        await prisma.recoveryOperation.update({ where: { id: operationId }, data: { progress } });
      },
    });
    if (sealed) await fs.rm(path.join(process.env.RECOVERY_STORAGE_DIR!, 'owner-inbox', operationId + '.json'), { force: true });
    console.log(JSON.stringify({ ok: true, operationId, action: restore ? 'RESTORE' : 'BACKUP' }));
  } catch {
    await prisma.$transaction(async tx => {
      await tx.recoveryOperation.updateMany({
        where: { id: operationId, status: { in: ['CREATING', 'RESTORING'] } },
        data: { status: 'FAILED', errorCode: restore ? 'RESTORE_FAILED' : 'BACKUP_CREATION_FAILED', errorMessage: 'Owner recovery failed.' },
      });
      await tx.recoveryAuditEvent.create({ data: {
        operationId, actorId: claim.actorId, eventType: restore ? 'RECOVERY_RESTORE_FAILED' : 'RECOVERY_BACKUP_FAILED', details: { code: 'OWNER_RECOVERY_FAILED' },
      } });
    });
    throw new Error('SYSTEM_RECOVERY_OWNER_BACKUP_FAILED');
  }
}

void main().catch(error => {
  const candidate = error instanceof Error ? error.message : null;
  const code = candidate && [
    'SYSTEM_RECOVERY_OWNER_ADMISSION_REJECTED',
    'SYSTEM_RECOVERY_OWNER_INPUT_INVALID',
    'SYSTEM_RECOVERY_OWNER_BACKUP_FAILED',
    'RUNTIME_CONTROL_OWNERSHIP_REQUIRED',
  ].includes(candidate) ? candidate : 'SYSTEM_RECOVERY_OWNER_FAILED';
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}).finally(() => disconnectDatabase()).catch(() => {
  console.error(JSON.stringify({ ok: false, code: 'SYSTEM_RECOVERY_OWNER_DISCONNECT_FAILED' }));
  process.exitCode = 1;
});
