import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Prisma, type PrismaClient, type User, type PerformanceSubject, type PerformanceEvaluation, type PerformanceEvaluationSection, type PerformanceAcceptedResult } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { enablePerformanceTestRelease, enrollPerformanceTestCohort, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';
import { requestPerformanceExport, cleanupExpiredPerformanceExports, processPerformanceExport } from '../personnelPerformanceDisclosureStore';
import { placePerformanceLegalHold, decidePerformanceLegalHold } from '../personnelPerformanceLegalHoldStore';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment, readPerformancePayload } from '../personnelPerformancePayloadStore';

const hash = (id: string) => createHash('sha256').update(id).digest('hex');
const from = new Date('2026-01-01Z');
const to = new Date('2026-04-01Z');
const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=4&pool_timeout=10', schemaOnly: true });
  const client = database.client();
  const second = database.client();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-lineage-'));
  const previousDirectory = process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR;
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = directory;
  try {
    await client.$executeRaw`INSERT INTO performance_disclosure_revision(id,revision) VALUES (1,0)`;
    const users: User[] = [];
    for (let i = 0; i < 2; i++) users.push(await client.user.create({ data: { email: `${randomUUID()}@example.invalid`, username: randomUUID(), password: 'unused', firstName: 'آزمون', lastName: 'نگهداری' } }));
    const actor = users[0];
    await client.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'آزمون' } });
    for (const featureCode of ['REQUEST_PERFORMANCE_EXPORT','VIEW_PERFORMANCE_ANALYTICS','VIEW_NAMED_PERFORMANCE_RANKING','PLACE_PERFORMANCE_LEGAL_HOLD','RELEASE_PERFORMANCE_LEGAL_HOLD']) {
      await client.hrFeatureCatalog.create({ data: { code: featureCode, workspaceCode: 'HUMAN_RESOURCES', displayName: featureCode } });
      for (const user of users) await client.hrFeatureAccessGrant.create({ data: { stableKey: randomUUID(), userId: user.id, featureCode, level: 'ADMIN', effectiveFrom: new Date('2000-01-01Z'), reason: 'Isolated export lineage regression' } });
    }
    await enablePerformanceTestRelease(client, actor.id);
    const policy = await publishPerformanceTestRetentionPolicy(client, actor.id);
    const unit = await client.hrOrganizationalUnit.create({ data: { code: randomUUID(), name: 'آزمون', type: 'DEPARTMENT', createdBy: actor.id } });
    const job = await client.hrJob.create({ data: { code: randomUUID(), title: 'آزمون', createdBy: actor.id } });
    const position = await client.hrPosition.create({ data: { code: randomUUID(), title: 'آزمون', jobId: job.id, organizationalUnitId: unit.id, createdBy: actor.id } });
    const keyring = performanceVaultKeyFromEnvironment();
    const population = async (withMissing: boolean) => {
      const subjects: PerformanceSubject[] = [];
      const evaluations: PerformanceEvaluation[] = [];
      const sections: PerformanceEvaluationSection[] = [];
      const results: PerformanceAcceptedResult[] = [];
      for (let i = 0; i < (withMissing ? 20 : 10); i++) {
        const person = await client.personnel.create({ data: { firstName: 'آزمون', lastName: randomUUID() } });
        const relationship = await client.hrEmploymentRelationship.create({ data: { personnelId: person.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01Z'), createdBy: actor.id } });
        const subject = await client.performanceSubject.create({ data: { stableKey: randomUUID(), nonDisplayKey: randomUUID(), personnelId: person.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id } });
        subjects.push(subject);
      }
      await enrollPerformanceTestCohort(client, actor.id, subjects.map(({ id }) => id));
      for (const subject of subjects.slice(0, 10)) {
        const assignment = await client.hrEmploymentAssignment.create({ data: { employmentRelationshipId: subject.employmentRelationshipId!, positionId: position.id, type: 'PRIMARY', effectiveFrom: new Date('2025-01-01Z'), createdBy: actor.id } });
        for (const month of [1, 2, 3]) {
          const evaluation = await client.performanceEvaluation.create({ data: { stableKey: randomUUID(), subjectId: subject.id, measurementFrom: new Date(`2026-0${month}-01Z`), measurementTo: new Date(`2026-0${month}-20Z`), createdByUserId: actor.id } });
          evaluations.push(evaluation);
          const section = await client.performanceEvaluationSection.create({ data: { evaluationId: evaluation.id, employmentAssignmentId: assignment.id, responsibleSupervisorPersonnelId: subject.personnelId!, effectiveFrom: evaluation.measurementFrom, effectiveTo: evaluation.measurementTo, allocationPercent: 100 } });
          sections.push(section);
          await client.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'SUBMITTED' } });
          await client.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'ACCEPTED' } });
          const tracePayload = await persistPerformancePayload(client, { aggregateType: 'CALCULATION_TRACE', aggregateId: evaluation.id, payloadKind: 'TRACE', schemaVersion: 1, payload: { fixture: true }, keyring });
          const trace = await client.performanceCalculationTrace.create({ data: { evaluationId: evaluation.id, traceVersion: 1, encryptedPayloadId: tracePayload.id, contentHash: tracePayload.contentHash } });
          const resultPayload = await persistPerformancePayload(client, { aggregateType: 'ACCEPTED_RESULT', aggregateId: evaluation.id, payloadKind: 'RESULT', schemaVersion: 1, payload: { templateSnapshotHash: 'test-template' }, keyring });
          const result = await client.performanceAcceptedResult.create({ data: { evaluationId: evaluation.id, version: 1, calculationTraceId: trace.id, encryptedPayloadId: resultPayload.id, exactScoreHash: hash('fixture-score'), levelCode: 'MEETS_EXPECTATIONS', levelPolicyVersionId: policy.id, acceptedByUserId: actor.id, expiresAt: new Date('2099-01-01Z') } });
          results.push(result);
          for (const status of ['READY_FOR_SUBMISSION','UNDER_REVIEW','ACCEPTED'] as const) await client.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status, ...(status === 'ACCEPTED' ? { acceptedResultId: result.id } : {}) } });
        }
      }
      return { subjects, evaluations, sections, results };
    };
    const readyExport = async (reportKind: 'AGGREGATE' | 'NAMED_RANKING' = 'AGGREGATE') => {
      const requested = await requestPerformanceExport(client, { actorUserId: actor.id, exportKind: 'XLSX', reportKind, purpose: 'Isolated source hold regression', reportingFrom: from, reportingTo: to });
      for (let i = 0; i < 1000; i++) {
        const receipt = await client.performanceExportReceipt.findUniqueOrThrow({ where: { id: requested.receipt.id } });
        if (receipt.status === 'READY') return receipt;
        if (i === 50 && receipt.status === 'QUEUED') await processPerformanceExport(client, receipt.id);
        if (receipt.status === 'FAILED') throw new Error(`Export failed: ${receipt.failureCode}`);
        await delay(10);
      }
      throw new Error('Export did not complete');
    };
    await population(false);
    const unrelated = await readyExport();
    const source = await population(true);
    const aggregate = await readyExport();
    const named = await readyExport('NAMED_RANKING');
    const lineage = await client.performanceExportLineage.findUniqueOrThrow({ where: { exportId: aggregate.id } });
    const reconstruction = await readPerformancePayload<{ sources: Array<{ aggregateType: string; id: string }>; reconstruction: { trendReconstruction: unknown } }>(client, lineage.reconstructionId, keyring);
    assert.ok(reconstruction.sources.some((row) => row.aggregateType === 'EVALUATION' && row.id === source.evaluations[0].id), 'earlier trend result is preserved although March supplies the displayed current result');
    assert.ok(reconstruction.sources.some((row) => row.aggregateType === 'PERFORMANCE_SUBJECT' && row.id === source.subjects[19].id), 'denominator-only subjects are part of source lineage');
    assert.ok(reconstruction.reconstruction.trendReconstruction);
    await assert.rejects(() => client.performanceExportDependency.deleteMany({ where: { exportId: aggregate.id } }), /append-only/);
    await assert.rejects(() => client.performanceExportLineage.update({ where: { exportId: aggregate.id }, data: { dependencyCount: 1 } }), /append-only/);
    await assert.rejects(() => client.performanceExportDependency.create({ data: { exportId: aggregate.id, aggregateType: 'EVALUATION', aggregateIdHash: hash('invented') } }), /sealed/);
    const failedPaths: string[] = [];
    for (let attemptCount = 2; attemptCount <= 3; attemptCount++) {
      const artifactPath = path.join(directory, `failed-${attemptCount}.enc`);
      await writeFile(artifactPath, Buffer.from('failed encrypted attempt'));
      await client.performanceExportArtifact.create({ data: { exportId: aggregate.id, attemptCount, artifactPath } });
      failedPaths.push(artifactPath);
    }
    const subjectHold = await placePerformanceLegalHold(client, { actorUserId: actor.id, aggregateType: 'PERFORMANCE_SUBJECT', aggregateId: source.subjects[0].id, reasonCode: 'SUBJECT_LITIGATION' });
    const sectionHold = await placePerformanceLegalHold(client, { actorUserId: actor.id, aggregateType: 'EVALUATION_SECTION', aggregateId: source.sections[0].id, reasonCode: 'SECTION_LITIGATION' });
    const future = new Date(Date.now() + 2 * 86_400_000);
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 1, 'unrelated export expires while dependent named and aggregate exports remain');
    await assert.rejects(() => access(unrelated.artifactPath!));
    for (const file of [aggregate.artifactPath!, named.artifactPath!, ...failedPaths]) await access(file);
    const release = async (holdId: string) => {
      for (const user of users) await decidePerformanceLegalHold(client, { actorUserId: user.id, holdId, action: 'APPROVE_RELEASE', reasonCode: 'LITIGATION_CLOSED' });
    };
    await release(subjectHold.id);
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 0, 'releasing a subject hold must recheck the descendant hold');
    for (const file of failedPaths) await access(file);
    const laterPayload = await persistPerformancePayload(client, { aggregateType: 'CALCULATION_TRACE', aggregateId: source.evaluations[0].id, payloadKind: 'LATER_TRACE', schemaVersion: 1, payload: { fixture: 'later source dispute evidence' }, keyring });
    const laterTrace = await client.performanceCalculationTrace.create({ data: { evaluationId: source.evaluations[0].id, traceVersion: 2, encryptedPayloadId: laterPayload.id, contentHash: laterPayload.contentHash } });
    const laterHold = await placePerformanceLegalHold(client, { actorUserId: actor.id, aggregateType: 'CALCULATION_TRACE', aggregateId: laterTrace.id, reasonCode: 'LATER_DESCENDANT_HOLD' });
    await release(sectionHold.id);
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 0, 'a later descendant hold still preserves exports of its source evaluation');
    const handoffId = randomUUID();
    const handoffPayload = await persistPerformancePayload(client, { aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoffId,
      payloadKind: 'IMMUTABLE_HANDOFF', schemaVersion: 1, payload: { selectedResults: [{ id: source.results[0].id }], recentTrend: [], projectionResultIds: [] }, keyring });
    await client.performanceConsequenceHandoff.create({ data: { id: handoffId, subjectId: source.subjects[0].id, personnelId: source.subjects[0].personnelId!, employmentRelationshipId: source.subjects[0].employmentRelationshipId!,
      consequenceType: 'COMPENSATION_REVIEW', policyCycleKey: randomUUID(), encryptedPayloadId: handoffPayload.id, snapshotHash: handoffPayload.contentHash, createdByUserId: actor.id } });
    const handoffHold = await placePerformanceLegalHold(client, { actorUserId: actor.id, aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoffId, reasonCode: 'CONSEQUENCE_LITIGATION' });
    await release(laterHold.id);
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 0, 'a held consequence using a report source preserves every dependent export');
    for (const file of [aggregate.artifactPath!, named.artifactPath!, ...failedPaths]) await access(file);
    await release(handoffHold.id);
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 2);
    for (const file of [aggregate.artifactPath!, named.artifactPath!, ...failedPaths]) await assert.rejects(() => access(file));
    assert.equal(await cleanupExpiredPerformanceExports(client, future), 0, 'cleanup is idempotent');
    assert.equal(await client.performanceExportDependency.count({ where: { exportId: aggregate.id } }), lineage.dependencyCount, 'source index remains immutable after artifact cleanup');
    assert.ok(await client.performanceAuditEvent.findFirst({ where: { aggregateId: aggregate.id, eventType: 'PERFORMANCE_EXPORT_CLEANED_UP' } }));
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => { resolve = done; });
      return { promise, resolve };
    };
    const waitFor = async (condition: () => Promise<boolean>, message: string) => {
      for (let i = 0; i < 500; i++) { if (await condition()) return; await delay(10); }
      throw new Error(message);
    };
    const blocked = async (pid: number) => (await client.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid = ${pid} AND NOT granted) AS blocked`)[0].blocked;
    const ordered = async <A, B>(winner: (tx: Prisma.TransactionClient) => Promise<A>, loser: (tx: Prisma.TransactionClient) => Promise<B>) => {
      const holding = deferred<void>(); const releaseWinner = deferred<void>(); const loserPid = deferred<number>();
      const winning = client.$transaction(async (tx) => { const result = await winner(tx); holding.resolve(); await releaseWinner.promise; return result; }, { timeout: 30_000 });
      let losing: Promise<B> | undefined;
      try {
        await Promise.race([holding.promise, winning.then(() => { throw new Error('Winner missed barrier'); })]);
        losing = second.$transaction(async (tx) => { const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; loserPid.resolve(row.pid); return loser(tx); }, { timeout: 30_000 });
        const observed = losing.then((value) => ({ value }), (error: unknown) => ({ error }));
        const pid = await loserPid.promise;
        await waitFor(() => blocked(pid), 'Expected actual database lock contention');
        releaseWinner.resolve(); const firstResult = await winning; const outcome = await observed;
        if ('error' in outcome) throw outcome.error;
        return { firstResult, secondResult: outcome.value };
      } finally { releaseWinner.resolve(); await Promise.allSettled([winning, ...(losing ? [losing] : [])]); }
    };
    const raceExport = await readyExport();
    const heldRace = await ordered(
      (tx) => placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION', aggregateId: source.evaluations[0].id, reasonCode: 'HOLD_WINS_CLEANUP' }),
      (tx) => cleanupExpiredPerformanceExports(tx, future),
    );
    assert.equal(heldRace.secondResult, 0);
    await access(raceExport.artifactPath!);
    await release(heldRace.firstResult.id);
    const cleanedRace = await ordered(
      (tx) => cleanupExpiredPerformanceExports(tx, future),
      (tx) => placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION', aggregateId: source.evaluations[0].id, reasonCode: 'CLEANUP_WINS_HOLD' }),
    );
    assert.equal(cleanedRace.firstResult, 1);
    await assert.rejects(() => access(raceExport.artifactPath!));
    await release(cleanedRace.secondResult.id);

    // Test-only PostgreSQL gates stop real worker publication/claim while the public services run.
    // No sleeps decide the winning order: every contender must be observed waiting in pg_locks.
    for (const publicationWins of [true, false]) {
      const gateReady = deferred<void>(); const openGate = deferred<void>();
      const gate = client.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(765365)`; gateReady.resolve(); await openGate.promise; }, { timeout: 30_000 });
      let holdWork: Promise<Awaited<ReturnType<typeof placePerformanceLegalHold>>> | undefined;
      const releaseHold = deferred<void>();
      await gateReady.promise;
      try {
        await client.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION export_test_gate() RETURNS trigger AS $$ BEGIN PERFORM pg_advisory_xact_lock(765365); RETURN NEW; END; $$ LANGUAGE plpgsql`);
        if (publicationWins) await client.$executeRawUnsafe(`CREATE TRIGGER export_test_gate BEFORE UPDATE ON performance_export_receipts FOR EACH ROW WHEN (NEW.status = 'READY') EXECUTE FUNCTION export_test_gate()`);
        else await client.$executeRawUnsafe(`CREATE TRIGGER export_test_gate BEFORE INSERT ON performance_export_artifacts FOR EACH ROW EXECUTE FUNCTION export_test_gate()`);
        const requested = await requestPerformanceExport(client, { actorUserId: actor.id, exportKind: 'XLSX', reportKind: 'AGGREGATE', purpose: 'Publication ordering regression', reportingFrom: from, reportingTo: to });
        await waitFor(async () => (await client.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND objid = 765365 AND NOT granted) AS blocked`)[0].blocked, 'Worker did not reach publication gate');
        const holdPid = deferred<number>(); const holdPlaced = deferred<void>();
        holdWork = second.$transaction(async (tx) => {
          const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; holdPid.resolve(row.pid);
          const hold = await placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION', aggregateId: source.evaluations[0].id, reasonCode: publicationWins ? 'PUBLICATION_WINS' : 'HOLD_WINS_PUBLICATION' });
          holdPlaced.resolve(); await releaseHold.promise; return hold;
        }, { timeout: 30_000 });
        const observedHold = holdWork.then((value) => ({ value }), (error: unknown) => ({ error }));
        const waitingHoldPid = await holdPid.promise;
        await waitFor(() => blocked(waitingHoldPid), 'Hold did not wait behind worker');
        openGate.resolve(); await gate;
        await Promise.race([holdPlaced.promise, observedHold.then(() => { throw new Error('Hold missed barrier'); })]);
        if (!publicationWins) {
          await waitFor(async () => (await client.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid <> ${await holdPid.promise} AND locktype IN ('transactionid','tuple') AND NOT granted) AS blocked`)[0].blocked, 'Publication did not wait behind hold');
        }
        releaseHold.resolve(); const outcome = await observedHold; if ('error' in outcome) throw outcome.error;
        await waitFor(async () => ['READY','FAILED'].includes((await client.performanceExportReceipt.findUniqueOrThrow({ where: { id: requested.receipt.id } })).status), 'Worker did not finish ordered publication');
        const completed = await client.performanceExportReceipt.findUniqueOrThrow({ where: { id: requested.receipt.id } });
        assert.equal(completed.attemptCount, 1, 'race reaches artifact generation, not only queue authorization');
        assert.equal(completed.status, publicationWins ? 'READY' : 'FAILED');
        const inventory = await client.performanceExportArtifact.findMany({ where: { exportId: completed.id } });
        assert.equal(inventory.length, 1, 'attempt inventory survives failed publication');
        if (publicationWins) await access(inventory[0].artifactPath); else await assert.rejects(() => access(inventory[0].artifactPath));
        assert.equal(await cleanupExpiredPerformanceExports(client, future), 0);
        await release(outcome.value.id);
        assert.equal(await cleanupExpiredPerformanceExports(client, future), 1);
      } finally {
        openGate.resolve(); releaseHold.resolve(); await Promise.allSettled([gate, ...(holdWork ? [holdWork] : [])]);
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS export_test_gate ON performance_export_receipts`);
        await client.$executeRawUnsafe(`DROP TRIGGER IF EXISTS export_test_gate ON performance_export_artifacts`);
      }
    }
    console.log('Export lineage regression passed: named/aggregate/trend/denominator sources; immutable evidence; descendant holds; failed files; unrelated expiry; dual release; four deterministic cleanup/publication orderings.');
  } finally {
    process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = previousDirectory;
    if (previousDirectory === undefined) delete process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR;
    await Promise.allSettled([client.$disconnect(), second.$disconnect()]);
    await database.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
};
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
