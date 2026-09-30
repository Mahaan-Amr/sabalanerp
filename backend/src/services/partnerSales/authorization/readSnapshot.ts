import { Prisma, type PrismaClient } from '@prisma/client';
import { lockPartnerOperationsControl, lockPartnerOperationsControlForRead } from './technicalRollout';

/** Multi-root reads enter the same lock graph as Partner writers before any
 * profile/Case authority. A permission or Case changed during the wait requires
 * a fresh repeatable-read snapshot, never partial output or stale authority. */
export async function readPartnerSnapshot<T>(database: PrismaClient, read: (tx: Prisma.TransactionClient) => Promise<T>, options: { multiRootAuthority?: boolean } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(async tx => {
        // Multi-root authority takes inquiry/profile update locks; serialize its
        // complete lock graph before acquiring any root.
        if (options.multiRootAuthority) await lockPartnerOperationsControl(tx);
        else await lockPartnerOperationsControlForRead(tx);
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
