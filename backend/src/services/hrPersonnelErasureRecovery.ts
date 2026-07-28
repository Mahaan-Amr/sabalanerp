import { Prisma, PrismaClient } from '@prisma/client';
import { restoreStagedHiringFiles } from './hrDeletionFileTransaction';

const RECOVERY_INTERVAL_MS = 60_000;
const STALE_PREPARATION_MS = 5 * 60_000;

type AccessRecoverySnapshot = {
  users: Array<{ id: string; isActive: boolean }>;
  sessionIds: string[];
};

const accessSnapshot = (value: Prisma.JsonValue): AccessRecoverySnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, Prisma.JsonValue>).accessRecovery;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const raw = candidate as Record<string, Prisma.JsonValue>;
  if (!Array.isArray(raw.users) || !Array.isArray(raw.sessionIds)) return null;
  const users = raw.users.flatMap((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user)) return [];
    const entry = user as Record<string, Prisma.JsonValue>;
    return typeof entry.id === 'string' && typeof entry.isActive === 'boolean' ? [{ id: entry.id, isActive: entry.isActive }] : [];
  });
  const sessionIds = raw.sessionIds.filter((id): id is string => typeof id === 'string');
  return { users, sessionIds };
};

export const recoverInterruptedPersonnelErasures = async (prisma: PrismaClient, now = new Date()) => {
  const receipts = await prisma.hrDeletionReceipt.findMany({
    where: {
      targetType: 'PERSONNEL',
      status: { in: ['PREPARING', 'ACCESS_PREPARED', 'RECOVERY_FAILED'] },
      updatedAt: { lt: new Date(now.getTime() - STALE_PREPARATION_MS) }
    }
  });
  let recovered = 0;
  for (const receipt of receipts) {
    try {
      const cleanupRows = await prisma.hrDeletionFileCleanup.findMany({ where: { receiptId: receipt.id } });
      restoreStagedHiringFiles(cleanupRows.map((row) => ({ storageName: row.storageName, originalPath: row.originalPath, stagedPath: row.stagedPath })));
      const snapshot = accessSnapshot(receipt.recordCounts);
      await prisma.$transaction(async (tx) => {
        if (snapshot?.sessionIds.length) await tx.authSession.updateMany({
          where: { id: { in: snapshot.sessionIds }, revocationReason: 'PERMANENT_PERSONNEL_ERASURE', revokedById: receipt.actorUserId },
          data: { revokedAt: null, revokedById: null, revocationReason: null }
        });
        for (const user of snapshot?.users || []) await tx.user.updateMany({ where: { id: user.id }, data: { isActive: user.isActive } });
        await tx.hrDeletionFileCleanup.deleteMany({ where: { receiptId: receipt.id } });
        await tx.hrDeletionReceipt.update({
          where: { id: receipt.id },
          data: { status: 'ABORTED', recordCounts: { aborted: true }, fileCounts: { restored: cleanupRows.length } }
        });
      });
      recovered += 1;
    } catch (error) {
      await prisma.hrDeletionReceipt.update({
        where: { id: receipt.id },
        data: { status: 'RECOVERY_FAILED', fileCounts: { recoveryError: error instanceof Error ? error.message : 'UNKNOWN_RECOVERY_ERROR' } }
      }).catch(() => undefined);
    }
  }
  return recovered;
};

export const startPersonnelErasureRecovery = (prisma: PrismaClient) => {
  const run = () => recoverInterruptedPersonnelErasures(prisma).catch((error) => console.error('Personnel erasure recovery failed:', error));
  run();
  const timer = setInterval(run, RECOVERY_INTERVAL_MS);
  timer.unref();
};
