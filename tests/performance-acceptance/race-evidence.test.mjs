import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePerformanceRaceMarker } from '../../scripts/performance-race-evidence.mjs';

const scenario = (name, overrides = {}) => ({
  name,
  database: 'PostgreSQL',
  actors: 2,
  deterministicBarrierObserved: true,
  validTruths: 1,
  duplicateEvents: 0,
  lostWrites: 0,
  additionalDisclosures: 0,
  loser: { accepted: false, code: 'PERFORMANCE_ALREADY_DECIDED' },
  ...overrides,
});

test('accepts exact scenario-level observed race evidence', () => {
  const marker = {
    schemaVersion: 1,
    contract: 'PERSONNEL_PERFORMANCE_RACE_EVIDENCE_V1',
    scenarios: [scenario('double-submit'), scenario('double-hr-decision')],
  };
  assert.equal(validatePerformanceRaceMarker(marker, ['double-submit', 'double-hr-decision']), true);
});

test('accepts a serialized successful loser only with a non-placeholder business response', () => {
  const marker = { schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_RACE_EVIDENCE_V1', scenarios: [
    scenario('correction-expiry-recomputation', {
      loser: { accepted: true, code: 'PERFORMANCE_RESULTS_EXPIRED_AND_RECOMPUTED' },
    }),
  ] };
  assert.equal(validatePerformanceRaceMarker(marker, ['correction-expiry-recomputation']), true);
});

test('rejects a suite-wide PASS label without scenario-level facts', () => {
  assert.equal(validatePerformanceRaceMarker({
    database: 'PostgreSQL', actors: 2, deterministicBarrierObserved: true,
    validTruths: 1, duplicateEvents: 0, lostWrites: 0, additionalDisclosures: 0,
    loserBusinessResponse: true, scenarios: ['double-submit'],
  }, ['double-submit']), false);
});

test('rejects missing, duplicate, or fabricated loser evidence', () => {
  const base = { schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_RACE_EVIDENCE_V1' };
  assert.equal(validatePerformanceRaceMarker({ ...base, scenarios: [scenario('double-submit')] },
    ['double-submit', 'double-hr-decision']), false);
  assert.equal(validatePerformanceRaceMarker({ ...base, scenarios: [scenario('double-submit'), scenario('double-submit')] },
    ['double-submit']), false);
  assert.equal(validatePerformanceRaceMarker({ ...base, scenarios: [scenario('double-submit', {
    loser: { accepted: true, code: 'OK' },
  })] }, ['double-submit']), false);
});
