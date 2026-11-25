import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma } from '@prisma/client';
import { BackgroundJobGroup } from '../backgroundJobLifecycle';
import { startRuntimeCapacityObservation } from '../runtimeCapacityObservation';

test('emits bounded workload windows and counts only work admitted by the scheduler boundary', async () => {
  let reads = 0;
  const poolMetrics = async (): Promise<Prisma.Metrics> => ({
    counters: [], gauges: [], histograms: [{
      key: 'prisma_client_queries_wait_histogram_ms',
      labels: { ignored: 'credential-looking-value' }, description: 'ignored text',
      value: reads++ === 0
        ? { buckets: [[1, 10], [5, 0], [10, 0]], count: 10, sum: 2 }
        : { buckets: [[1, 11], [5, 1], [10, 1]], count: 13, sum: 16 },
    }],
  });
  const published: unknown[] = [];
  const stopObservation = startRuntimeCapacityObservation({
    commit: 'local', poolMetrics, intervalMs: 75,
    emit: window => { published.push(window); },
  });
  const admitted = new BackgroundJobGroup(async work => work());
  const refused = new BackgroundJobGroup(async () => undefined);
  try {
    admitted.start({ name: 'notification-outbox', intervalMs: 60_000, run: async () => {} });
    refused.start({ name: 'notification-digest', intervalMs: 60_000, run: async () => assert.fail() });
    await admitted.stop(500);
    await refused.stop(500);
    for (let attempt = 0; published.length === 0 && attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const [window] = published as Array<Record<string, unknown>>;
    assert.equal(window.kind, 'backend_capacity_window');
    assert.equal(window.commit, 'local');
    assert.equal(window.pid, process.pid);
    assert.deepEqual(window.poolWait, { samples: 3, totalMs: 14, p95UpperMs: 10 });
    assert.ok((window.memory as { rssBytes: number }).rssBytes > 0);
    assert.ok((window.eventLoop as { samples: number }).samples > 0);
    const jobs = window.jobs as Array<{ name: string; completed: number; failed: number; maxMs: number }>;
    assert.deepEqual(jobs.map(({ name, completed, failed }) => ({ name, completed, failed })), [
      { name: 'notification-outbox', completed: 1, failed: 0 },
    ]);
    assert.ok(jobs[0].maxMs >= 0);
    assert.doesNotMatch(JSON.stringify(window), /credential-looking-value|ignored text/);
  } finally {
    stopObservation();
  }
});

test('emits process measurements when native Prisma metrics are unavailable', async () => {
  const published: unknown[] = [];
  const stop = startRuntimeCapacityObservation({
    commit: 'unattested', intervalMs: 75,
    poolMetrics: async () => { throw new Error('private driver detail'); },
    emit: window => { published.push(window); },
  });
  try {
    for (let attempt = 0; published.length === 0 && attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(published[0] && typeof published[0] === 'object' && 'poolWait' in published[0]);
    assert.equal(published[0].poolWait, null);
    assert.doesNotMatch(JSON.stringify(published), /private driver detail/);
  } finally { stop(); }
});

test('stopping optional observation does not wait for the native metrics reader', () => {
  const stop = startRuntimeCapacityObservation({
    commit: 'local', poolMetrics: () => new Promise<never>(() => {}),
    emit: () => assert.fail('Observation must stay stopped'),
  });
  assert.equal(stop(), undefined);
  assert.equal(stop(), undefined);
});
