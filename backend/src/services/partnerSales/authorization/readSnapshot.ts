import { Prisma, type PrismaClient } from '@prisma/client';
import { lockPartnerOperationsControl } from './technicalRollout';

/** Multi-root reads enter the same lock graph as Partner writers before any
 * profile/Case authority. A permission or Case changed during the wait requires
 * a fresh repeatable-read snapshot, never partial output or stale authority. */
export async function readPartnerSnapshot<T>(database: PrismaClient, read: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        return read(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } };
      const retryable = failure.code === 'P2034' || failure.meta?.code === '40001' ||
        (failure.code === 'P2010' && failure.meta?.code === '40P01');
      if (attempt >= 1 || !retryable) throw error;
    }
  }
}
