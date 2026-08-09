import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TwoPartyBarrier, ConcurrencyBarrierTimeoutError } from './barrier';
import { assertTemporaryConcurrencyDatabaseName, temporaryDatabaseUrl } from './database';
import { ConcurrencyTrace } from './trace';
import { isRetryableConcurrencyError } from './retry';

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
  assert.equal(isRetryableConcurrencyError({ code: 'P2010', meta: { code: '40001' } }), true);
  assert.equal(isRetryableConcurrencyError({ code: 'P2010', meta: { code: '40P01' } }), true);
  assert.equal(isRetryableConcurrencyError({ code: 'P2002' }), false);

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
