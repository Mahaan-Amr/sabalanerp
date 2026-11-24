import { Prisma, type PrismaClient } from '@prisma/client';
import { measureAccountingReadPhase } from '../../accountingReadTiming';
import { lockPartnerOperationsControl, lockPartnerOperationsControlForRead } from './technicalRollout';

/** Enter the rollout fence before resource authority. A permission or Case
 * changed during a lock wait requires a fresh repeatable-read snapshot. */
export async function readPartnerSnapshot<T>(database: PrismaClient, read: (tx: Prisma.TransactionClient) => Promise<T>, options: { multiRootAuthority?: boolean } = {}) {
  return retryReadSnapshot(() => database.$transaction(async tx => {
    // Callers acquiring command locks serialize the complete resource graph.
    // Shared callers must keep subsequent row locks compatible with readers.
    const lock = options.multiRootAuthority === false ? lockPartnerOperationsControlForRead : lockPartnerOperationsControl;
    await measureAccountingReadPhase('lockWait', async () => { await lock(tx); });
    return read(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }));
}

export async function retryReadSnapshot<T>(read: () => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } };
      const retryable = failure.code === 'P2034' || failure.meta?.code === '40001' ||
        (failure.code === 'P2010' && failure.meta?.code === '40P01');
      if (attempt >= 1 || !retryable) throw error;
    }
  }
}
