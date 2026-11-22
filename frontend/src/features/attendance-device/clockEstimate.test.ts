import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateScanClock, type ClockSample } from './clockEstimate';

test('clock compensation keeps raw time intact and expires instead of rewriting historical evidence', () => {
  const now = Date.parse('2026-10-17T07:00:00Z');
  const raw = '2026-10-17T06:59:25Z';
  const sample: ClockSample = { terminalId: 'test', evidence: { offsetMs: 35000, uncertaintyMs: 1050, measuredAt: new Date(now).toISOString() } };
  assert.deepEqual(estimateScanClock(raw, sample, now), { at: '2026-10-17T07:00:00.000Z', uncertaintySeconds: '1.1' });
  assert.equal(raw, '2026-10-17T06:59:25Z');
  assert.equal(estimateScanClock(raw, { ...sample, evidence: { ...sample.evidence, uncertaintyMs: 15000 } }, now)?.uncertaintySeconds, '15.0');
  assert.equal(estimateScanClock(raw, { ...sample, evidence: { ...sample.evidence, uncertaintyMs: 15001 } }, now), null);
  assert.equal(estimateScanClock(raw, { ...sample, evidence: { ...sample.evidence, offsetMs: 300001 } }, now), null);
  assert.equal(estimateScanClock(raw, sample, now + 121000), null);
  assert.equal(estimateScanClock('2026-10-16T07:00:00Z', sample, now), null);
  assert.equal(estimateScanClock(raw, undefined, now), null);
  assert.equal(estimateScanClock(raw, { ...sample, evidence: { ...sample.evidence, measuredAt: 'invalid' } }, now), null);
});
