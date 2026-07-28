import fs from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  finalizePromotedRecovery,
  INQUIRY_RESTART_MARKER,
  readRestoreJournal,
  removeRecoveryPackage,
  rollbackInterruptedRecovery,
} from './systemRecoveryEngine';
import { RECOVERY_FRESHNESS_MS } from './systemRecoveryPolicy';
import { setRecoveryRuntimeState } from './recoveryRuntime';

const recoverInterruptedRestore = async (prisma: PrismaClient) => {
  const journal = await readRestoreJournal();
  if (!journal) {
    await fs.promises.rm(INQUIRY_RESTART_MARKER, { force: true });
    setRecoveryRuntimeState('NORMAL');
    await prisma.recoveryOperation.updateMany({
      where: { status: { in: ['CREATING', 'VALIDATING', 'RESTORING'] } },
      data: { status: 'FAILED', errorCode: 'PROCESS_INTERRUPTED', errorMessage: 'The recovery worker was interrupted before completion.' },
    });
    return;
  }
  setRecoveryRuntimeState('MAINTENANCE', journal.operationId, 'Completing recovery startup checks.');
  const databases = await prisma.$queryRawUnsafe<Array<{ datname: string }>>(
    `SELECT datname FROM pg_database WHERE datname IN ('${journal.stagedDatabase.replace(/'/g, "''")}', '${journal.safetyDatabase.replace(/'/g, "''")}')`,
  );
  const names = new Set(databases.map((row) => row.datname));
  const promoted = journal.phase === 'DATABASE_PROMOTED' || (names.has(journal.safetyDatabase) && !names.has(journal.stagedDatabase));
  if (promoted) await finalizePromotedRecovery(prisma, journal);
  else await rollbackInterruptedRecovery(journal);
  await fs.promises.rm(INQUIRY_RESTART_MARKER, { force: true });
  setRecoveryRuntimeState('NORMAL');
};

const cleanupExpiredPackages = async (prisma: PrismaClient) => {
  const expired = await prisma.recoveryOperation.findMany({
    where: { expiresAt: { lte: new Date() }, storageName: { not: null }, status: { notIn: ['RESTORING'] } },
    select: { id: true, source: true, storageName: true },
  });
  for (const item of expired) {
    await removeRecoveryPackage(item.source, item.storageName);
    await prisma.recoveryOperation.update({
      where: { id: item.id },
      data: { status: 'EXPIRED', storageName: null },
    });
  }
};

const notifyStaleBackup = async (prisma: PrismaClient) => {
  const latest = await prisma.recoveryOperation.findFirst({
    where: { packageType: 'COMPLETE', downloadedAt: { not: null } },
    orderBy: { downloadedAt: 'desc' },
    select: { downloadedAt: true },
  });
  if (latest?.downloadedAt && Date.now() - latest.downloadedAt.getTime() < RECOVERY_FRESHNESS_MS) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const duplicate = await prisma.securityNotification.findFirst({
    where: { type: 'RECOVERY_BACKUP_STALE', createdAt: { gte: since } },
  });
  if (duplicate) return;
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
  if (!admins.length) return;
  await prisma.securityNotification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      type: 'RECOVERY_BACKUP_STALE',
      title: 'نسخه پشتیبان بازیابی به‌روز نیست',
      message: 'بیش از هفت روز است که نسخه پشتیبان کامل دانلود نشده است. فایل باقی‌مانده روی همین سرور محافظت در برابر خرابی سرور نیست.',
    })),
  });
};

export const initializeSystemRecovery = async (prisma: PrismaClient) => {
  try {
    await recoverInterruptedRestore(prisma);
    await cleanupExpiredPackages(prisma);
    await notifyStaleBackup(prisma);
  } catch (error) {
    setRecoveryRuntimeState('MAINTENANCE', undefined, 'Recovery startup verification failed. Server operator intervention is required.');
    console.error('System recovery initialization failed:', error);
  }
};

export const startSystemRecoveryMaintenance = (prisma: PrismaClient) => {
  const timer = setInterval(() => {
    cleanupExpiredPackages(prisma).then(() => notifyStaleBackup(prisma)).catch((error) => {
      console.error('System recovery maintenance failed:', error);
    });
  }, 60 * 60 * 1000);
  timer.unref();
};
