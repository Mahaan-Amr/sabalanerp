import { startBackgroundJob } from './backgroundJobLifecycle';
import { Prisma, PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import { restoreStagedHiringFiles } from './hrDeletionFileTransaction';
import { readHrLegacyFileCleanupRows } from './hrLegacyFileCleanupRows';

const RECOVERY_INTERVAL_MS = 60_000;
export const PERSONNEL_ERASURE_LEASE_MS = 5 * 60_000;

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
      status: { in: ['PREPARING', 'ACCESS_PREPARED', 'RECOVERING', 'RECOVERY_FAILED'] },
      leaseExpiresAt: { lt: now }
    }
  });
  let recovered = 0;
  for (const receipt of receipts) {
    const recoveryToken = `RECOVERY:${crypto.randomUUID()}`;
    const cleanupRows = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','10000ms',true)`;
      // Both versioned plan insertion and claim transitions lock this parent.
      // Inspect cleanup rows in a fresh READ COMMITTED statement AFTER the
      // lock: a pre-lock snapshot can miss a just-committed versioned plan.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.hr_deletion_receipts
        WHERE id=${receipt.id} AND status=${receipt.status} AND "operationToken" IS NOT DISTINCT FROM ${receipt.operationToken}
          AND "leaseExpiresAt"<${now} FOR UPDATE`;
      if (locked.length !== 1) return null;
      const planned = await readHrLegacyFileCleanupRows(tx, receipt.id);
      // This compensator owns only ADR-0033's legacy raw-rename format.
      // Unknown/versioned work retains original ownership and receipts.
      if (planned.some(row => row.status !== 'PREPARING' || row.legacyFileState !== true)) return null;
      const claimed = await tx.hrDeletionReceipt.updateMany({
        where: { id: receipt.id, status: receipt.status, operationToken: receipt.operationToken, leaseExpiresAt: { lt: now } },
        data: { status: 'RECOVERING', operationToken: recoveryToken, leaseExpiresAt: new Date(now.getTime() + PERSONNEL_ERASURE_LEASE_MS) }
      });
      return claimed.count === 1 ? planned : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 1000 });
    if (cleanupRows === null) continue;
    let recoveryOwned = true;
    try {
      for (const row of cleanupRows) {
        const renewed = await prisma.hrDeletionReceipt.updateMany({
          where: { id: receipt.id, status: 'RECOVERING', operationToken: recoveryToken },
          data: { leaseExpiresAt: new Date(Date.now() + PERSONNEL_ERASURE_LEASE_MS) }
        });
        if (renewed.count !== 1) { recoveryOwned = false; throw new Error('Personnel erasure recovery lease was lost.'); }
        restoreStagedHiringFiles([{ storageName: row.storageName, originalPath: row.originalPath, stagedPath: row.stagedPath }]);
      }
      const snapshot = accessSnapshot(receipt.recordCounts);
      await prisma.$transaction(async (tx) => {
        const renewed = await tx.hrDeletionReceipt.updateMany({
          where: { id: receipt.id, status: 'RECOVERING', operationToken: recoveryToken },
          data: { leaseExpiresAt: new Date(Date.now() + PERSONNEL_ERASURE_LEASE_MS) }
        });
        if (renewed.count !== 1) { recoveryOwned = false; throw new Error('Personnel erasure recovery lease was lost.'); }
        if (snapshot?.sessionIds.length) await tx.authSession.updateMany({
          where: { id: { in: snapshot.sessionIds }, revocationReason: 'PERMANENT_PERSONNEL_ERASURE', revokedById: receipt.actorUserId },
          data: { revokedAt: null, revokedById: null, revocationReason: null }
        });
        for (const user of snapshot?.users || []) await tx.user.updateMany({ where: { id: user.id }, data: { isActive: user.isActive } });
        await tx.hrDeletionFileCleanup.deleteMany({ where: { receiptId: receipt.id } });
        const completed = await tx.hrDeletionReceipt.updateMany({
          where: { id: receipt.id, status: 'RECOVERING', operationToken: recoveryToken },
          data: { status: 'ABORTED', operationToken: null, leaseExpiresAt: null, recordCounts: { aborted: true }, fileCounts: { restored: cleanupRows.length } }
        });
        if (completed.count !== 1) { recoveryOwned = false; throw new Error('Personnel erasure recovery lease was lost.'); }
      });
      recovered += 1;
    } catch (error) {
      if (!recoveryOwned) continue;
      await prisma.hrDeletionReceipt.updateMany({
        where: { id: receipt.id, status: 'RECOVERING', operationToken: recoveryToken },
        data: {
          status: 'RECOVERY_FAILED', operationToken: recoveryToken,
          leaseExpiresAt: new Date(Date.now() + PERSONNEL_ERASURE_LEASE_MS),
          fileCounts: { recoveryError: error instanceof Error ? error.message : 'UNKNOWN_RECOVERY_ERROR' }
        }
      }).catch(() => undefined);
    }
  }
  return recovered;
};

export const startPersonnelErasureRecovery = (prisma: PrismaClient) => {
  const run = () => recoverInterruptedPersonnelErasures(prisma).catch((error) => console.error('Personnel erasure recovery failed:', error));
  return startBackgroundJob({ name: 'startPersonnelErasureRecovery', intervalMs: RECOVERY_INTERVAL_MS, run });
};
