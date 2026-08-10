import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { bindFinalizedAllocationPricing } from '../../allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from '../../allocationPricingPrismaAdapter';
import { TwoPartyBarrier } from './barrier';
import { createTemporaryConcurrencyDatabase } from './database';
import { createConcurrentPricingFixture } from './pricingFixture';
import { runSerializableWithRetry } from './retry';
import { ConcurrencyTrace, type ScenarioResult } from './trace';

type ChildProof = Record<string, unknown> & { scenarios: ScenarioResult[]; events: Array<{
  scenario: string; actor: string; phase: string; outcome: string; detail?: Record<string, unknown>;
}> };

const exactChildProof = (stdout: string, input: { kind: string; parentRunId: string; parentDatabaseName: string;
  databaseName?: string;
  scenarios: string[] }): ChildProof => {
  const proofs = stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => { try { return JSON.parse(line) as ChildProof; } catch { return null; } })
    .filter((line): line is ChildProof => line?.kind === input.kind);
  assert.equal(proofs.length, 1, `${input.kind} must emit exactly one terminal proof envelope`);
  const proof = proofs[0];
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.parentRunId, input.parentRunId);
  assert.equal(proof.parentDatabaseName, input.parentDatabaseName);
  if (input.databaseName) assert.equal(proof.databaseName, input.databaseName);
  assert.deepEqual(proof.scenarios.map(scenario => scenario.name), input.scenarios);
  assert.ok(proof.scenarios.every(scenario => scenario.repetitions === 1 && scenario.anomalies.length === 0));
  assert.ok(Array.isArray(proof.events) && proof.events.length >= input.scenarios.length);
  assert.ok(proof.events.every(event => input.scenarios.includes(event.scenario)
    && event.actor && event.phase && event.outcome && typeof event.detail?.attempt === 'number'
    && typeof event.detail?.durationMs === 'number'
    && Object.prototype.hasOwnProperty.call(event.detail, 'databaseCode')));
  return proof;
};

const mergeChildProof = (proof: ChildProof, trace: ConcurrencyTrace, results: ScenarioResult[]) => {
  proof.events.forEach(event => trace.record(event));
  results.push(...proof.scenarios);
};

const run = async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, 'DATABASE_URL must target sabalanerp-local');
  assert.equal(process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED, 'true',
    'the release-gate runner must explicitly enable customer shipment statements');
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
          });
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

    const financialRun = spawnSync(process.execPath, [path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.resolve(process.cwd(), 'src', 'services', '__tests__', 'shipmentStatementConcurrency',
        'productionFinancialLogistics.test.ts')], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, DATABASE_URL: database.databaseUrl, ISSUE260_PARENT_RUN_ID: database.runId,
        ISSUE260_PARENT_DATABASE_NAME: database.databaseName } });
    assert.equal(financialRun.error, undefined, `financial/logistics production subprocess failed: ${financialRun.error?.message || ''}`);
    assert.equal(financialRun.signal, null, `financial/logistics production subprocess timed out or was killed: ${financialRun.signal || ''}`);
    assert.equal(financialRun.status, 0, `financial/logistics production subprocess failed\n${financialRun.stdout}\n${financialRun.stderr}`);
    const financialProof = exactChildProof(financialRun.stdout, { kind: 'issue260-financial-logistics-production-proof',
      parentRunId: database.runId, databaseName: database.databaseName,
      parentDatabaseName: database.databaseName,
      scenarios: ['financial-approval-vs-finalization-and-acceptance'] });
    assert.equal(financialProof.finalBinding, 'ATOMIC_WAYBILL_STATEMENT');
    assert.equal(financialProof.acceptanceStatus, 'STALE_REQUIRES_SUCCESSOR');
    assert.equal(financialProof.readinessPublishedAfterCommit, true);
    assert.match(String(financialProof.boundPricingVersionId), /^[0-9a-f-]{36}$/i);
    mergeChildProof(financialProof, trace, results);

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

    const issuanceRun = spawnSync(process.execPath, [path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.resolve(process.cwd(), 'src', 'services', '__tests__', 'dispatchDocumentsIssuanceConcurrency.test.ts')], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, DATABASE_URL: sourceDatabaseUrl, ISSUE260_PARENT_RUN_ID: database.runId,
        ISSUE260_PARENT_DATABASE_NAME: database.databaseName },
    });
    assert.equal(issuanceRun.error, undefined, `production issuance subprocess failed: ${issuanceRun.error?.message || ''}`);
    assert.equal(issuanceRun.signal, null, `production issuance subprocess timed out or was killed: ${issuanceRun.signal || ''}`);
    assert.equal(issuanceRun.status, 0, `production issuance subprocess failed\n${issuanceRun.stdout}\n${issuanceRun.stderr}`);
    const issuanceProof = exactChildProof(issuanceRun.stdout, { kind: 'issue260-production-issuance-concurrency-proof',
      parentRunId: database.runId, parentDatabaseName: database.databaseName,
      scenarios: ['accept-vs-reject-or-successor',
        'issuance-idempotency-artifact-commit-retry', 'void-or-replace-vs-guard-exit'] });
    assert.match(String(issuanceProof.databaseName), /^sabalanerp_dispatchdocs_[a-f0-9]{16}$/);
    assert.match(String(issuanceProof.runId), /^[a-f0-9]{16}$/);
    assert.notEqual(issuanceProof.runId, database.runId);
    assert.notEqual(issuanceProof.databaseName, database.databaseName);
    assert.equal(issuanceProof.unknownResponseInjectedAfterCommit, true);
    assert.equal(issuanceProof.decisionWinner, 'ACCEPTED');
    assert.ok(['GUARD_EXIT', 'REPLACEMENT'].includes(String(issuanceProof.lifecycleWinner)));
    assert.equal(issuanceProof.issuedWaybills, 1);
    assert.equal(issuanceProof.issuedArtifacts, 2);
    mergeChildProof(issuanceProof, trace, results);

    const adjustmentRun = spawnSync(process.execPath, [
      path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.resolve(process.cwd(), 'src', 'services', '__tests__', 'statementAdjustmentPrisma.test.ts'),
    ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000, env: {
      ...process.env, DATABASE_URL: database.databaseUrl, ISSUE262_TWO_CONNECTION_RACE: '1',
      ISSUE260_PARENT_RUN_ID: database.runId,
      ISSUE260_PARENT_DATABASE_NAME: database.databaseName,
    } });
    assert.equal(adjustmentRun.error, undefined,
      `statement adjustment production-seam subprocess failed: ${adjustmentRun.error?.message || ''}`);
    assert.equal(adjustmentRun.signal, null,
      `statement adjustment production-seam subprocess timed out or was killed: ${adjustmentRun.signal || ''}`);
    assert.equal(adjustmentRun.status, 0,
      `statement adjustment production-seam subprocess failed\n${adjustmentRun.stdout}\n${adjustmentRun.stderr}`);
    const adjustmentProof = exactChildProof(adjustmentRun.stdout, { kind: 'issue260-statement-adjustment-concurrency-proof',
      parentRunId: database.runId, databaseName: database.databaseName,
      parentDatabaseName: database.databaseName,
      scenarios: ['concurrent-correction-adjustment-sequence-posting',
        'verified-return-vs-reship-final-remainder-attribution'] });
    assert.deepEqual(adjustmentProof.sequenceRange, [4, 7]);
    assert.equal(adjustmentProof.artifactCount, 4);
    assert.equal(adjustmentProof.zeroNetQuantity, '0.000');
    assert.equal(adjustmentProof.zeroNetAmount, '0.000000000000');
    mergeChildProof(adjustmentProof, trace, results);

    assert.equal(results.length, 8, 'the issue260 release gate must retain exactly the eight required race scenarios');
    assert.deepEqual([...results.map(result => result.name)].sort(), [
      'accept-vs-reject-or-successor', 'competing-finalizations-scale-twelve-remainder',
      'concurrent-correction-adjustment-sequence-posting', 'financial-approval-vs-finalization-and-acceptance',
      'issuance-idempotency-artifact-commit-retry', 'retry-after-deadlock',
      'verified-return-vs-reship-final-remainder-attribution', 'void-or-replace-vs-guard-exit',
    ].sort());
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
