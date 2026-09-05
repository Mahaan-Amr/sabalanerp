import assert from 'node:assert/strict';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { setTimeout as delay } from 'node:timers/promises';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { enablePerformanceTestRelease } from './personnelPerformanceTestRelease';
import { createPerformancePolicyDraft, updatePerformancePolicyDraft } from '../personnelPerformancePolicyStore';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';
import { disablePersonnelPerformanceBeforeFirstWrite, getPersonnelPerformanceOperationsState, pausePersonnelPerformance } from '../personnelPerformanceOperationsStore';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const iterations = Number(process.env.PERFORMANCE_RACE_ITERATIONS ?? '100');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('Invalid race iteration count');
const main = async () => {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
      sourceDatabaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10', schemaOnly: true });
    const first = database.client();
    const second = database.client();
    try {
      await first.$executeRaw`INSERT INTO performance_disclosure_revision(id,revision) VALUES (1,0)`;
      const actor = await first.user.create({ data: { email: `${database.runId}@example.invalid`, username: database.runId, password: 'not-used', firstName: 'عامل', lastName: 'رقابت' } });
      await first.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'آزمون منابع انسانی' } });
      for (const code of ['MANAGE_PERFORMANCE_ROLLOUT','PAUSE_PERFORMANCE_EVALUATION']) {
        await first.hrFeatureCatalog.create({ data: { code, workspaceCode: 'HUMAN_RESOURCES', displayName: code } });
        await first.hrFeatureAccessGrant.create({ data: { stableKey: `${database.runId}:${code}`, userId: actor.id, featureCode: code, level: 'ADMIN', effectiveFrom: new Date('2000-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated deterministic safety race' } });
      }
      await enablePerformanceTestRelease(first, actor.id);
      const runOrderedRace = async <A, B>(winner: (tx: Prisma.TransactionClient) => Promise<A>, loser: (tx: Prisma.TransactionClient) => Promise<B>, expectedCode: string) => {
        const winnerHolding = deferred<void>();
        const releaseWinner = deferred<void>();
        const loserPid = deferred<number>();
        const winning = first.$transaction(async (tx) => {
          const result = await winner(tx); winnerHolding.resolve();
          await releaseWinner.promise; return result;
        }, { timeout: 30_000 });
        // Always release and await both actors even if a barrier assertion fails.
        let losing: Promise<B> | undefined;
        try {
          await Promise.race([winnerHolding.promise, winning.then(() => { throw new Error('Winner did not reach barrier'); })]);
          losing = second.$transaction(async (tx) => {
            const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            loserPid.resolve(row.pid); return loser(tx);
          }, { timeout: 30_000 });
          const observedLoser = losing.then(() => ({ success: true as const }), (error: unknown) => ({ success: false as const, error }));
          const pid = await Promise.race([loserPid.promise, observedLoser.then(() => { throw new Error('Loser did not reach barrier'); })]);
          let blocked = false;
          for (let poll = 0; poll < 500; poll++) {
            const [row] = await first.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted) AS blocked`;
            if (row.blocked) { blocked = true; break; }
            const settled = await Promise.race([observedLoser.then(() => true), delay(10).then(() => false)]);
            if (settled) break;
          }
          assert.equal(blocked, true, 'loser must actually wait on the winner; scheduling alone is not a deterministic barrier');
          releaseWinner.resolve(); await winning;
          const result = await observedLoser;
          assert.equal(result.success, false);
          if (!result.success) assert.equal((result.error as { code?: string }).code, expectedCode);
        } finally {
          releaseWinner.resolve();
          await Promise.allSettled([winning, ...(losing ? [losing] : [])]);
        }
      };
      await runOrderedRace(
        (tx) => disablePersonnelPerformanceBeforeFirstWrite(tx, { actorUserId: actor.id, reason: 'Disable before the first write' }),
        (tx) => createPerformancePolicyDraft(tx, { policyKind: 'RETENTION', content: PERFORMANCE_RETENTION_SCHEDULE_V1, createdByUserId: actor.id }),
        'PERFORMANCE_RELEASE_DISABLED',
      );
      assert.equal((await getPersonnelPerformanceOperationsState(first)).firstCanonicalWriteAt, null);
      await enablePerformanceTestRelease(first, actor.id);
      await runOrderedRace(
        (tx) => createPerformancePolicyDraft(tx, { policyKind: 'RETENTION', content: PERFORMANCE_RETENTION_SCHEDULE_V1, createdByUserId: actor.id }),
        (tx) => disablePersonnelPerformanceBeforeFirstWrite(tx, { actorUserId: actor.id, reason: 'Disable racing with first write' }),
        'PERFORMANCE_FIX_FORWARD_REQUIRED',
      );
      assert.equal((await getPersonnelPerformanceOperationsState(first)).rollbackMode, 'EVIDENCE_PRESERVING_FIX_FORWARD');
      const draft = await first.performancePolicyVersion.findFirstOrThrow({ where: { policyKind: 'RETENTION' } });
      const phase = await first.performanceFeaturePhaseVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
      await runOrderedRace(
        (tx) => pausePersonnelPerformance(tx, { actorUserId: actor.id, phaseVersionId: phase.id, scope: 'ALL', reasonCode: 'INTEGRITY_MISMATCH', reason: 'Pause racing with canonical update' }),
        (tx) => updatePerformancePolicyDraft(tx, { versionId: draft.id, content: PERFORMANCE_RETENTION_SCHEDULE_V1 }),
        'PERFORMANCE_SAFETY_PAUSED',
      );
      if ((iteration + 1) % 10 === 0 || iteration + 1 === iterations) console.log(`Safety races: ${iteration + 1}/${iterations}; three deterministic orderings passed.`);
    } finally {
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await database.cleanup();
    }
  }
  console.log(JSON.stringify({ schemaVersion: 1, suite: 'performance-control-fence-regressions', iterations, deterministicOrderings: 3, failures: 0,
    completeTwelveRacePromotionEvidence: false }));
};
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
