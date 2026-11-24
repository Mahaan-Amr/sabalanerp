import assert from 'node:assert/strict';
import test from 'node:test';
import { options, summarizeSurface } from '../measure-accounting-browser.mjs';

const sample = (phase, duration = 2_000) => ({ phase, firstActionMs: 1_000, completeMs: duration });
const target = { name: 'dashboard', target: true, phase: 'mixed' };

test('a slow warm cohort fails even when the combined p95 is under three seconds', () => {
  const samples = Array.from({ length: 20 }, (_, index) => sample(index % 2 === 0 ? 'cold' : 'warm'));
  samples[19] = sample('warm', 3_000);
  const result = summarizeSurface(samples, target);
  assert.deepEqual(result.completeMs, { count: 20, p95: 2_000 });
  assert.deepEqual(result.byPhase.cold.completeMs, { count: 10, p95: 2_000 });
  assert.deepEqual(result.byPhase.warm.completeMs, { count: 10, p95: 3_000 });
  assert.equal(result.byPhase.cold.target.passed, true);
  assert.equal(result.byPhase.warm.target.passed, false);
  assert.equal(result.target.passed, false);
});

test('mixed timing requires complete readiness in both browser phases', () => {
  const cold = sample('cold');
  const warm = sample('warm');
  assert.equal(summarizeSurface([cold, warm], target).target.passed, true);
  for (const incomplete of [
    { ...warm, firstActionMs: undefined },
    { ...warm, completeMs: undefined },
    { ...warm, failed: true },
    { ...warm, data: { chart: 'empty' } },
  ]) {
    assert.equal(summarizeSurface([cold, incomplete], target).byPhase.warm.target.passed, false);
  }
  assert.equal(summarizeSurface([cold], target).target.passed, false);
  assert.equal(summarizeSurface([cold], { ...target, phase: 'cold' }).target.passed, true);
});

test('a mixed run cannot start with fewer than two samples', () => {
  const env = {
    ACCOUNTING_TIMING_COMMIT: 'a'.repeat(40),
    ACCOUNTING_TIMING_WORKLOAD: 'parity',
    ACCOUNTING_TIMING_RUN: 'candidate',
    ACCOUNTING_TIMING_OUTPUT: 'receipt.json',
    ACCOUNTING_TIMING_IDENTIFIER: 'fixture',
    ACCOUNTING_TIMING_PASSWORD: 'fixture',
    ACCOUNTING_TIMING_PHASE: 'mixed',
    ACCOUNTING_TIMING_SAMPLES: '1',
  };
  assert.throws(() => options(env), { message: 'INVALID_TIMING_INPUT' });
  assert.equal(options({ ...env, ACCOUNTING_TIMING_SAMPLES: '2' }).samples, 2);
});
