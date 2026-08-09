import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { bindFinalizedAllocationPricing } from '../../allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from '../../allocationPricingPrismaAdapter';
import { assessBoundAllocationPricingFreshness } from '../../allocationPricingReadModel';
import { PrismaApprovedPricingRepository } from '../../approvedPricing/prismaRepository';
import { verifyDispatchArtifactStorageUnderLock } from '../../dispatchDocuments/artifactStorageLock';
import { TwoPartyBarrier } from './barrier';
import { createTemporaryConcurrencyDatabase } from './database';
import { advanceConcurrentPricingVersion, createConcurrentPricingFixture } from './pricingFixture';
import { runSerializableWithRetry } from './retry';
import { ConcurrencyTrace, type ScenarioResult } from './trace';

const run = async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, 'DATABASE_URL must target sabalanerp-local');
  const database = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl });
  const first = database.client();
  const second = database.client();
  const observer = database.client();
  const trace = new ConcurrencyTrace({ runId: database.runId,
    outputDirectory: path.resolve(process.cwd(), '..', 'test-results', 'shipment-statement-concurrency', database.runId) });
  const results: ScenarioResult[] = [];
  try {
    const fixture = await createConcurrentPricingFixture(observer, database.runId);
    const barrier = new TwoPartyBarrier('competing-finalizations-before-pricing-lock', 10_000);
    const started = performance.now();
    const finalize = (client: typeof first, line: typeof fixture.lines[number], actor: string) =>
      runSerializableWithRetry({ client, actor, scenario: 'competing-finalizations-scale-twelve-remainder', trace,
        work: async (tx, attempt) => {
          if (attempt === 1) await barrier.arrive(actor);
          trace.record({ scenario: 'competing-finalizations-scale-twelve-remainder', actor,
            phase: 'pricing-lock-requested', outcome: 'started', detail: { attempt, revisionId: line.revisionId } });
          return bindFinalizedAllocationPricing(createPrismaAllocationPricingBindingPort(tx), {
            allocationRevisionId: line.revisionId, finalizedAt: line.revision.finalizedAt, actorId: actor,
            scope: fixture.scope, expectedCurrency: 'IRR', lines: [{ allocationRevisionLineId: line.id,
              contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
              productRowId: line.productRowId, quantity: line.quantity.toFixed(3), unit: line.unit }],
          }, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' });
        } });
    const [firstResult, secondResult] = await Promise.all([
      finalize(first, fixture.lines[0], `${fixture.actorId}-first`),
      finalize(second, fixture.lines[1], `${fixture.actorId}-second`),
    ]);
    assert.equal(firstResult.path, 'ATOMIC_WAYBILL_STATEMENT');
    assert.equal(secondResult.path, 'ATOMIC_WAYBILL_STATEMENT');
    const events = await observer.dispatchPricedAllocationEvent.findMany({ where: { pricingRowId: fixture.rowId }, orderBy: { recordedAt: 'asc' } });
    assert.equal(events.length, 2, 'both distinct finalizations produce exactly one immutable priced event');
    assert.equal(new Set(events.map(event => event.allocationRevisionLineId)).size, 2);
    assert.equal(events.reduce((sum, event) => sum.add(event.quantity), new Prisma.Decimal(0)).toFixed(3), fixture.contractedQuantity);
    assert.equal(events.reduce((sum, event) => sum.add(event.grossAmount), new Prisma.Decimal(0)).toFixed(12), '100.000000000000');
    assert.equal(events.reduce((sum, event) => sum.add(event.discountAmount), new Prisma.Decimal(0)).toFixed(12), '10.000000000000');
    assert.equal(events.reduce((sum, event) => sum.add(event.netAmount), new Prisma.Decimal(0)).toFixed(12), '90.000000000000');
    assert.equal(events.filter(event => event.consumesFinalRemainder).length, 1,
      'only the serialization winner that consumes the final quantity receives the exact remainder');
    assert.equal(await observer.logisticsAllocationRevisionPricing.count({ where: { pricingVersionId: fixture.versionId } }), 2);
    results.push({ name: 'competing-finalizations-scale-twelve-remainder', repetitions: 1, anomalies: [],
      durationMs: Number((performance.now() - started).toFixed(3)) });

    const pricingRaceBarrier = new TwoPartyBarrier('pricing-replacement-vs-accounting-freshness', 10_000);
    const financialAdvance = runSerializableWithRetry({ client: first, actor: `${fixture.actorId}-financial`,
      scenario: 'financial-approval-vs-finalization-and-acceptance', trace, work: async (tx, attempt) => {
        if (attempt === 1) await pricingRaceBarrier.arrive('financial');
        return new PrismaApprovedPricingRepository(tx).withContractLock(fixture.item.contractId,
          () => advanceConcurrentPricingVersion(tx, fixture, database.runId));
      } });
    const accountingFreshness = runSerializableWithRetry({ client: second, actor: `${fixture.actorId}-accounting`,
      scenario: 'financial-approval-vs-finalization-and-acceptance', trace, work: async (tx, attempt) => {
        if (attempt === 1) await pricingRaceBarrier.arrive('accounting');
        await createPrismaAllocationPricingBindingPort(tx).lockPricingScope([
          `APPROVED_PRICING_HEAD:${fixture.item.contractId}`,
        ]);
        return assessBoundAllocationPricingFreshness(tx, fixture.lines[0].revisionId);
      } });
    const [advancedVersionId, freshnessAtCommit] = await Promise.all([financialAdvance, accountingFreshness]);
    assert.ok(['CURRENT', 'STALE_REQUIRES_SUCCESSOR'].includes(freshnessAtCommit.status),
      'Accounting observes either the old head before replacement commits or the new head after it commits');
    assert.equal((await observer.contractApprovedPricingHead.findUniqueOrThrow({
      where: { contractId: fixture.item.contractId } })).currentVersionId, advancedVersionId);
    assert.equal((await observer.$transaction(tx => assessBoundAllocationPricingFreshness(tx,
      fixture.lines[0].revisionId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).status,
    'STALE_REQUIRES_SUCCESSOR', 'a committed pricing replacement makes the earlier bound allocation stale');
    results.push({ name: 'financial-approval-vs-finalization-and-acceptance', repetitions: 1, anomalies: [] });

    const lockContracts = await observer.salesContract.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 2 });
    assert.equal(lockContracts.length, 2, 'Deadlock retry diagnostic requires two production contract rows.');
    const deadlockBarrier = new TwoPartyBarrier('opposite-order-deadlock-diagnostic', 10_000);
    const deadlockDiagnostic = (client: typeof first, actor: string, reverse: boolean) => runSerializableWithRetry({
      client, actor, scenario: 'retry-after-deadlock', trace, work: async (tx, attempt) => {
        const ordered = reverse ? [...lockContracts].reverse() : lockContracts;
        const lockOrder = attempt === 1 ? ordered : [...lockContracts].sort((left, right) => left.id.localeCompare(right.id));
        trace.record({ scenario: 'retry-after-deadlock', actor, phase: 'lock-order', outcome: attempt === 1 ? 'fault-injected' : 'deterministic-retry',
          detail: { attempt, lockOrder: lockOrder.map(item => item.id) } });
        await tx.$queryRawUnsafe('SELECT "id" FROM "sales_contracts" WHERE "id" = $1 FOR UPDATE', lockOrder[0].id);
        if (attempt === 1) await deadlockBarrier.arrive(actor);
        await tx.$queryRawUnsafe('SELECT "id" FROM "sales_contracts" WHERE "id" = $1 FOR UPDATE', lockOrder[1].id);
        return true;
      } });
    assert.deepEqual(await Promise.all([deadlockDiagnostic(first, `${fixture.actorId}-deadlock-a`, false),
      deadlockDiagnostic(second, `${fixture.actorId}-deadlock-b`, true)]), [true, true]);
    results.push({ name: 'retry-after-deadlock', repetitions: 1, anomalies: [] });

    const candidate = await observer.accountingDispatchCandidate.findFirst({ where: { waybills: { none: {} } }, orderBy: { id: 'asc' } });
    assert.ok(candidate, 'Concurrency snapshot requires a candidate without a waybill.');
    await observer.accountingDispatchCandidate.update({ where: { id: candidate.id }, data: { status: 'PENDING',
      dispositionAt: null, dispositionBy: null, dispositionReason: null } });
    const decisionBarrier = new TwoPartyBarrier('accept-vs-reject', 10_000);
    const decide = (client: typeof first, actor: string, status: 'ACCEPTED' | 'REJECTED') => runSerializableWithRetry({
      client, actor, scenario: 'accept-vs-reject-or-successor', trace, work: async (tx, attempt) => {
        const observed = await tx.accountingDispatchCandidate.findUniqueOrThrow({ where: { id: candidate.id }, select: { status: true } });
        if (attempt === 1) await decisionBarrier.arrive(actor);
        if (observed.status !== 'PENDING') return false;
        const changed = await tx.accountingDispatchCandidate.updateMany({ where: { id: candidate.id, status: 'PENDING' },
          data: { status, dispositionAt: new Date(), dispositionBy: actor, dispositionReason: status } });
        if (changed.count === 1) await tx.dispatchLifecycleAudit.create({ data: { id: `${database.runId}-${status.toLowerCase()}`,
          aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id, eventType: `CONCURRENCY_${status}`,
          payload: { runId: database.runId }, actorId: actor, eventHash: `${status === 'ACCEPTED' ? 'c' : 'd'}${database.runId.padEnd(63, '0')}`.slice(0, 64) } });
        return changed.count === 1;
      } });
    const decisions = await Promise.all([decide(first, `${fixture.actorId}-accept`, 'ACCEPTED'),
      decide(second, `${fixture.actorId}-reject`, 'REJECTED')]);
    assert.equal(decisions.filter(Boolean).length, 1, 'only one terminal candidate decision commits');
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: { aggregateId: candidate.id,
      eventType: { in: ['CONCURRENCY_ACCEPTED', 'CONCURRENCY_REJECTED'] } } }), 1, 'losing decision emits no audit event');
    results.push({ name: 'accept-vs-reject-or-successor', repetitions: 1, anomalies: [] });

    const waybill = await observer.accountingDispatchWaybill.findFirst({ where: { status: 'ISSUED', physicalExit: null,
      manualOutageExit: null, replacementWaybill: null }, orderBy: { id: 'asc' } });
    assert.ok(waybill, 'Concurrency snapshot requires one unexited waybill.');
    const lifecycleBarrier = new TwoPartyBarrier('void-replace-vs-guard-exit', 10_000);
    const transition = (client: typeof first, actor: string, status: 'VOIDED' | 'EXIT_RECORDED') => runSerializableWithRetry({
      client, actor, scenario: 'void-or-replace-vs-guard-exit', trace, work: async (tx, attempt) => {
        const observed = await tx.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: waybill.id }, select: { status: true } });
        if (attempt === 1) await lifecycleBarrier.arrive(actor);
        if (observed.status !== 'ISSUED') return false;
        const changed = await tx.accountingDispatchWaybill.updateMany({ where: { id: waybill.id, status: 'ISSUED' }, data: { status } });
        if (changed.count === 1) await tx.dispatchLifecycleAudit.create({ data: { id: `${database.runId}-${status.toLowerCase()}`,
          aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, eventType: `CONCURRENCY_${status}`,
          payload: { runId: database.runId }, actorId: actor,
          eventHash: createHash('sha256').update(`${database.runId}:${status}`).digest('hex') } });
        return changed.count === 1;
      } });
    const transitions = await Promise.all([transition(first, `${fixture.actorId}-documents`, 'VOIDED'),
      transition(second, `${fixture.actorId}-guard`, 'EXIT_RECORDED')]);
    assert.equal(transitions.filter(Boolean).length, 1, 'void/replacement and Guard exit cannot both win');
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: { aggregateId: waybill.id,
      eventType: { in: ['CONCURRENCY_VOIDED', 'CONCURRENCY_EXIT_RECORDED'] } } }), 1);
    results.push({ name: 'void-or-replace-vs-guard-exit', repetitions: 1, anomalies: [] });

    const artifactBytes = new TextEncoder().encode(`dispatch-bundle-${database.runId}`);
    const artifact = { id: `concurrency-artifact-${database.runId}`, waybillId: waybill.id, kind: 'WAYBILL' as const,
      templateVersion: 'concurrency-v1', storageKey: `dispatch-documents/concurrency-${database.runId}.pdf`,
      mediaType: 'application/pdf', byteLength: artifactBytes.byteLength,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'), sourceIntegrityHash: '3'.repeat(64),
      publishedBy: fixture.actorId };
    const storage = { stage: async () => undefined, read: async (key: string) => key === artifact.storageKey ? artifactBytes : null };
    const operationKey = `issue-${database.runId}`;
    const intentFingerprint = createHash('sha256').update(`${candidate.id}:atomic-bundle`).digest('hex');
    const rollbackMarker = new Error('intentional database commit failure');
    await assert.rejects(() => observer.$transaction(async tx => {
      await verifyDispatchArtifactStorageUnderLock({ transaction: tx, storage, artifacts: [artifact] });
      await tx.dispatchDocumentArtifact.create({ data: artifact });
      await tx.dispatchDocumentCommandResult.create({ data: { scope: 'CANDIDATE', scopeId: candidate.id,
        idempotencyKey: operationKey, command: 'ACCEPT_AND_ISSUE', status: 'SUCCEEDED',
        result: { intentFingerprint, value: { artifactId: artifact.id } }, actorId: fixture.actorId,
        correlationId: `rollback-${database.runId}`, completedAt: new Date() } });
      throw rollbackMarker;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), error => error === rollbackMarker);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { id: artifact.id } }), 0,
      'database commit failure retains neither artifact metadata nor command result');
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: operationKey } }), 0);

    const issuanceBarrier = new TwoPartyBarrier('same-idempotency-key-issuance', 10_000);
    const issue = (client: typeof first, actor: string, idempotencyKey: string, fingerprint: string, coordinate = false) => runSerializableWithRetry({
      client, actor, scenario: 'issuance-idempotency-artifact-commit-retry', trace,
      retryWhen: error => idempotencyKey === operationKey && (error as { code?: string })?.code === 'P2002',
      work: async (tx, attempt) => {
        if (attempt === 1 && coordinate) await issuanceBarrier.arrive(actor);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',
          `ACCOUNTING_DISPATCH_CANDIDATE:${candidate.id}`);
        const prior = await tx.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: {
          scope: 'CANDIDATE', scopeId: candidate.id, idempotencyKey } } });
        if (prior) {
          const envelope = prior.result as { intentFingerprint?: string; value?: { artifactId?: string } };
          if (prior.command !== 'ACCEPT_AND_ISSUE' || envelope.intentFingerprint !== fingerprint) throw new Error('IDEMPOTENCY_INTENT_CONFLICT');
          return envelope.value!;
        }
        await verifyDispatchArtifactStorageUnderLock({ transaction: tx, storage, artifacts: [artifact] });
        await tx.dispatchDocumentArtifact.create({ data: artifact });
        const value = { artifactId: artifact.id };
        await tx.dispatchDocumentCommandResult.create({ data: { scope: 'CANDIDATE', scopeId: candidate.id,
          idempotencyKey, command: 'ACCEPT_AND_ISSUE', status: 'SUCCEEDED', result: { intentFingerprint: fingerprint, value },
          actorId: actor, correlationId: actor, completedAt: new Date() } });
        await tx.dispatchLifecycleAudit.create({ data: { id: `issuance-audit-${database.runId}`,
          aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, eventType: 'CONCURRENCY_PRIMARY_BUNDLE_ISSUED',
          payload: { idempotencyKey, artifactId: artifact.id }, actorId: actor,
          eventHash: createHash('sha256').update(`${database.runId}:issuance`).digest('hex') } });
        return value;
      } });
    const sameKey = await Promise.all([issue(first, `${fixture.actorId}-issue-a`, operationKey, intentFingerprint, true),
      issue(second, `${fixture.actorId}-issue-b`, operationKey, intentFingerprint, true)]);
    assert.deepEqual(sameKey[0], sameKey[1], 'same-key retry replays the exact persisted issuance result');
    const unknownResponseReplay = await issue(first, `${fixture.actorId}-unknown-response-retry`, operationKey, intentFingerprint);
    assert.deepEqual(unknownResponseReplay, sameKey[0]);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { id: artifact.id } }), 1);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: operationKey } }), 1);
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: { eventType: 'CONCURRENCY_PRIMARY_BUNDLE_ISSUED',
      aggregateId: waybill.id } }), 1);
    await assert.rejects(() => issue(second, `${fixture.actorId}-different-key`, `${operationKey}-different`,
      createHash('sha256').update(`${candidate.id}:different-intent`).digest('hex')),
    error => (error as { code?: string }).code === 'P2002' || /unique constraint/i.test(String(error)));
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: `${operationKey}-different` } }), 0, 'different-key duplicate bundle leaves no partial command result');
    results.push({ name: 'issuance-idempotency-artifact-commit-retry', repetitions: 1, anomalies: [] });

    const adjustmentStarted = performance.now();
    trace.record({ scenario: 'concurrent-correction-adjustment-sequence-posting', actor: 'issue262-production-seam',
      phase: 'two-connection-run', outcome: 'started', detail: { databaseName: database.databaseName } });
    const adjustmentRun = spawnSync(process.execPath, [
      path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.resolve(process.cwd(), 'src', 'services', '__tests__', 'statementAdjustmentPrisma.test.ts'),
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000, env: {
      ...process.env, DATABASE_URL: database.databaseUrl, ISSUE262_TWO_CONNECTION_RACE: '1',
    } });
    assert.equal(adjustmentRun.error, undefined,
      `statement adjustment production-seam subprocess failed: ${adjustmentRun.error?.message || ''}`);
    assert.equal(adjustmentRun.signal, null,
      `statement adjustment production-seam subprocess timed out or was killed: ${adjustmentRun.signal || ''}`);
    assert.equal(adjustmentRun.status, 0,
      `statement adjustment production-seam subprocess failed\n${adjustmentRun.stdout}\n${adjustmentRun.stderr}`);
    const adjustmentProof = adjustmentRun.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
      .find(line => line?.kind === 'issue260-statement-adjustment-concurrency-proof');
    assert.ok(adjustmentProof, `statement adjustment proof was not emitted\n${adjustmentRun.stdout}`);
    assert.deepEqual(adjustmentProof.scenarios, ['concurrent-correction-adjustment-sequence-posting',
      'verified-return-vs-reship-final-remainder-attribution']);
    assert.deepEqual(adjustmentProof.sequenceRange, [4, 7]);
    assert.equal(adjustmentProof.artifactCount, 4);
    assert.equal(adjustmentProof.zeroNetQuantity, '0.000');
    assert.equal(adjustmentProof.zeroNetAmount, '0.000000000000');
    const adjustmentDurationMs = Number((performance.now() - adjustmentStarted).toFixed(3));
    trace.record({ scenario: 'concurrent-correction-adjustment-sequence-posting', actor: 'issue262-production-seam',
      phase: 'two-connection-run', outcome: 'committed', detail: { ...adjustmentProof, durationMs: adjustmentDurationMs } });
    trace.record({ scenario: 'verified-return-vs-reship-final-remainder-attribution', actor: 'issue262-production-seam',
      phase: 'return-reship-settled', outcome: 'zero-anomaly', detail: { ...adjustmentProof, durationMs: adjustmentDurationMs } });
    results.push({ name: 'concurrent-correction-adjustment-sequence-posting', repetitions: 1, anomalies: [],
      durationMs: adjustmentDurationMs });
    results.push({ name: 'verified-return-vs-reship-final-remainder-attribution', repetitions: 1, anomalies: [],
      durationMs: adjustmentDurationMs });

    const report = await trace.finish(results);
    assert.equal(report.summary.status, 'ZERO_ANOMALIES');
    console.log(JSON.stringify({ runId: database.runId, tracePath: report.tracePath, summaryPath: report.summaryPath,
      scenarios: results.map(result => result.name), anomalyCount: 0 }));
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect(), observer.$disconnect()]);
    await database.cleanup();
  }
};

run().then(() => console.log('shipment statement real PostgreSQL concurrency scenarios: ok'));
