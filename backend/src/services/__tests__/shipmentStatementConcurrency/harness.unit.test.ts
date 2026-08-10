import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TwoPartyBarrier, ConcurrencyBarrierTimeoutError } from './barrier';
import { assertSabalanerpLocalPostgresTarget, assertTemporaryConcurrencyDatabaseName, temporaryDatabaseUrl } from './database';
import { ConcurrencyTrace } from './trace';
import { isRetryableConcurrencyError } from './retry';
import { assertStatementAdjustmentRaceEvidence } from './statementAdjustmentEvidence';

const run = async () => {
  const barrier = new TwoPartyBarrier('pricing-head-locked', 1000);
  const order: string[] = [];
  await Promise.all([
    barrier.arrive('financial').then(() => order.push('financial')),
    barrier.arrive('logistics').then(() => order.push('logistics')),
  ]);
  assert.deepEqual(new Set(order), new Set(['financial', 'logistics']));
  assert.deepEqual(barrier.participants, ['financial', 'logistics']);
  await assert.rejects(() => new TwoPartyBarrier('missing-peer', 5).arrive('only'), ConcurrencyBarrierTimeoutError);

  assert.equal(assertTemporaryConcurrencyDatabaseName('sabalanerp_concurrency_0123456789abcdef'),
    'sabalanerp_concurrency_0123456789abcdef');
  assert.throws(() => assertTemporaryConcurrencyDatabaseName('sabalanerp'));
  assert.throws(() => assertTemporaryConcurrencyDatabaseName('sabalanerp_concurrency_0123;drop database sabalanerp'));
  assert.equal(temporaryDatabaseUrl('postgresql://postgres:secret@127.0.0.1:55432/sabalanerp?schema=public',
    'sabalanerp_concurrency_0123456789abcdef'),
  'postgresql://postgres:secret@127.0.0.1:55432/sabalanerp_concurrency_0123456789abcdef?schema=public');
  assert.throws(() => temporaryDatabaseUrl('postgresql://postgres:secret@example.com:5432/production',
    'sabalanerp_concurrency_0123456789abcdef'));
  assert.deepEqual(assertSabalanerpLocalPostgresTarget(JSON.stringify([{ Project: 'sabalanerp-local', Service: 'postgres',
    State: 'running', Health: 'healthy', Name: 'sabalanerp-local-postgres-1' }])), {
    project: 'sabalanerp-local', service: 'postgres', container: 'sabalanerp-local-postgres-1',
  });
  assert.throws(() => assertSabalanerpLocalPostgresTarget(JSON.stringify([{ Project: 'other', Service: 'postgres',
    State: 'running', Health: 'healthy', Name: 'other-postgres-1' }])), /refusing docker target/i);
  assert.throws(() => assertSabalanerpLocalPostgresTarget(JSON.stringify([{ Project: 'sabalanerp-local', Service: 'postgres',
    State: 'running', Health: 'unhealthy', Name: 'sabalanerp-local-postgres-1' }])), /verified healthy/i);
  assert.equal(isRetryableConcurrencyError({ code: 'P2010', meta: { code: '40001' } }), true);
  assert.equal(isRetryableConcurrencyError({ code: 'P2010', meta: { code: '40P01' } }), true);
  assert.equal(isRetryableConcurrencyError({ code: 'P2002' }), false);

  assert.deepEqual(assertStatementAdjustmentRaceEvidence({
    sequencePosts: [
      { reason: 'DB sequence race A', adjustmentId: 'adjustment-a', sequence: 4, integrityHash: 'a'.repeat(64),
        artifact: { id: 'artifact-a', sourceIntegrityHash: 'a'.repeat(64) }, commandCount: 1,
        commandAdjustmentId: 'adjustment-a', auditCount: 1, adjustmentIntegrityVerified: true, auditIntegrityVerified: true },
      { reason: 'DB sequence race B', adjustmentId: 'adjustment-b', sequence: 5, integrityHash: 'b'.repeat(64),
        artifact: { id: 'artifact-b', sourceIntegrityHash: 'b'.repeat(64) }, commandCount: 1,
        commandAdjustmentId: 'adjustment-b', auditCount: 1, adjustmentIntegrityVerified: true, auditIntegrityVerified: true },
    ],
    returnAndReship: [
      { reason: 'DB concurrent verified return', adjustmentId: 'adjustment-return', sequence: 6, integrityHash: 'c'.repeat(64),
        artifact: { id: 'artifact-return', sourceIntegrityHash: 'c'.repeat(64) }, commandCount: 1,
        commandAdjustmentId: 'adjustment-return', auditCount: 1, adjustmentIntegrityVerified: true, auditIntegrityVerified: true,
        line: { contractId: 'contract', contractItemId: 'item', productRowId: 'row', quantityDelta: '-0.001',
          grossAmountDelta: '-0.100000000000', discountDelta: '0.000000000000', netAmountDelta: '-0.100000000000',
          consumesFinalRemainder: false } },
      { reason: 'DB concurrent reship', adjustmentId: 'adjustment-reship', sequence: 7, integrityHash: 'd'.repeat(64),
        artifact: { id: 'artifact-reship', sourceIntegrityHash: 'd'.repeat(64) }, commandCount: 1,
        commandAdjustmentId: 'adjustment-reship', auditCount: 1, adjustmentIntegrityVerified: true, auditIntegrityVerified: true,
        line: { contractId: 'contract', contractItemId: 'item', productRowId: 'row', quantityDelta: '0.001',
          grossAmountDelta: '0.100000000000', discountDelta: '0.000000000000', netAmountDelta: '0.100000000000',
          consumesFinalRemainder: true } },
    ],
    consumedReturnEvidenceCount: 1,
  }), { sequenceRange: [4, 7], artifactCount: 4, zeroNetQuantity: '0.000', zeroNetAmount: '0.000000000000' });
  assert.throws(() => assertStatementAdjustmentRaceEvidence({
    sequencePosts: [], returnAndReship: [], consumedReturnEvidenceCount: 0,
  }), /exactly two sequence posts/i);

  const output = await mkdtemp(path.join(os.tmpdir(), 'sabalan-concurrency-trace-'));
  try {
    const trace = new ConcurrencyTrace({ runId: '0123456789abcdef', outputDirectory: output });
    trace.record({ scenario: 'approval-vs-finalization', actor: 'financial', phase: 'commit', outcome: 'won',
      detail: { lockOrder: ['record', 'pricing-head'] } });
    trace.record({ scenario: 'approval-vs-finalization', actor: 'logistics', phase: 'retry', outcome: 'deterministic-loser' });
    const report = await trace.finish([{ name: 'approval-vs-finalization', repetitions: 1, anomalies: [] }]);
    assert.equal(report.summary.anomalyCount, 0);
    assert.equal(report.summary.eventCount, 2);
    const lines = (await readFile(report.tracePath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines.map(line => line.sequence), [1, 2]);
    assert.equal(JSON.parse(await readFile(report.summaryPath, 'utf8')).status, 'ZERO_ANOMALIES');
  } finally { await rm(output, { recursive: true, force: true }); }
};

run().then(() => console.log('shipment statement concurrency harness unit tests passed'));
