import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, PrismaClient } from '@prisma/client';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

export type PerformanceRaceObservation<A, B> = {
  winner: A;
  loser: { status: 'fulfilled'; value: B } | { status: 'rejected'; error: unknown };
  deterministicBarrierObserved: true;
};

export const performanceBusinessErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  if (error.code === 'P2034') return 'PERFORMANCE_WRITE_RETRY_REQUIRED';
  if (error.code === 'P2010' && 'meta' in error && error.meta && typeof error.meta === 'object'
    && 'code' in error.meta && ['40001', '40P01'].includes(String(error.meta.code))) {
    return 'PERFORMANCE_WRITE_RETRY_REQUIRED';
  }
  return typeof error.code === 'string' ? error.code : null;
};

export const runOrderedPerformanceRace = async <A, B>(
  observer: PrismaClient,
  first: PrismaClient,
  second: PrismaClient,
  winner: (tx: Prisma.TransactionClient) => Promise<A>,
  loser: (tx: Prisma.TransactionClient) => Promise<B>,
): Promise<PerformanceRaceObservation<A, B>> => {
  const winnerHolding = deferred<void>();
  const releaseWinner = deferred<void>();
  const loserPid = deferred<number>();
  const winning = first.$transaction(async (tx) => {
    const result = await winner(tx);
    winnerHolding.resolve();
    await releaseWinner.promise;
    return result;
  }, { timeout: 30_000 });
  let losing: Promise<B> | undefined;
  try {
    await Promise.race([winnerHolding.promise, winning.then(() => { throw new Error('Winner missed the transaction barrier'); })]);
    losing = second.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      loserPid.resolve(row.pid);
      return loser(tx);
    }, { timeout: 30_000 });
    const observedLoser = losing.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    const pid = await Promise.race([
      loserPid.promise,
      observedLoser.then(() => { throw new Error('Loser completed before reaching the transaction barrier'); }),
    ]);
    let blocked = false;
    for (let poll = 0; poll < 500; poll += 1) {
      const [row] = await observer.$queryRaw<Array<{ blocked: boolean }>>`
        SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted) AS blocked`;
      if (row.blocked) { blocked = true; break; }
      const settled = await Promise.race([observedLoser.then(() => true), delay(10).then(() => false)]);
      if (settled) break;
    }
    assert.equal(blocked, true, 'loser must wait on a real PostgreSQL lock owned by the winner');
    releaseWinner.resolve();
    const winnerResult = await winning;
    return { winner: winnerResult, loser: await observedLoser, deterministicBarrierObserved: true };
  } finally {
    releaseWinner.resolve();
    await Promise.allSettled([winning, ...(losing ? [losing] : [])]);
  }
};

export const raceEvidenceMarker = (scenarios: Array<{
  name: string;
  loserCode: string;
  validTruths: number;
  duplicateEvents: number;
  lostWrites: number;
  additionalDisclosures: number;
  loserAccepted?: boolean;
}>) => `PERFORMANCE_ACCEPTANCE_RACE:${JSON.stringify({
  schemaVersion: 1,
  contract: 'PERSONNEL_PERFORMANCE_RACE_EVIDENCE_V1',
  scenarios: scenarios.map(({ loserCode, loserAccepted = false, ...scenario }) => ({
    ...scenario,
    database: 'PostgreSQL',
    actors: 2,
    deterministicBarrierObserved: true,
    loser: { accepted: loserAccepted, code: loserCode },
  })),
})}`;
