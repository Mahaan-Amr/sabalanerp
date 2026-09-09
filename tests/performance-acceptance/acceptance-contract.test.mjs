import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX,
  PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES,
  PERFORMANCE_ACCEPTANCE_DEFERRALS,
  PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS,
  PERFORMANCE_ACCEPTANCE_RACES,
  buildPerformanceAcceptancePlan,
} from '../../scripts/performance-acceptance-contract.mjs';

const requiredRaces = [
  'double-submit', 'double-hr-decision', 'submit-context-change', 'accept-policy-activation',
  'accept-cancel-invalidate-pause', 'correction-expiry-recomputation', 'export-revoke-correction-hold',
  'deletion-legal-hold', 'cohort-pause-write', 'reconstruction-hr-write',
  'unknown-response-after-commit', 'notification-export-retry',
];

test('the release race contract fixes every approved two-actor race at 100 iterations', () => {
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_RACES.map(({ name }) => name), requiredRaces);
  assert.equal(new Set(PERFORMANCE_ACCEPTANCE_RACES.map(({ name }) => name)).size, 12);
  for (const race of PERFORMANCE_ACCEPTANCE_RACES) {
    assert.equal(race.actors, 2);
    assert.equal(race.iterations, 100);
    assert.ok(race.publicBoundary.length > 0);
    assert.deepEqual(race.invariants, [
      'ONE_VALID_TRUTH', 'NO_LOST_WRITE', 'NO_DUPLICATE_EVENT_OR_RESULT',
      'NO_ADDITIONAL_DISCLOSURE', 'LOSER_HAS_BUSINESS_RESPONSE',
    ]);
  }
});

test('failure and browser acceptance cannot silently omit an approved dimension', () => {
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS,
    ['transaction', 'queue', 'storage', 'encryption', 'notification', 'migration', 'reconciliation', 'restore']);
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.viewports, [360, 390, 768, 1280, 1920]);
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.themes, ['light', 'dark']);
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.interactionModes,
    ['keyboard', 'focus', 'reduced-motion', 'zoom-200']);
  assert.equal(PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.direction, 'rtl');
  assert.equal(PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.persistence, 'REAL_LOCAL_POSTGRESQL');
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES, [
    'persisted-route-identifier-enumeration-equivalence',
    'persisted-route-search-count-placeholder-nondisclosure',
    'browser-cache-no-store',
    'persisted-malicious-text-inert-browser-rendering',
  ]);
});

test('approved production inputs remain explicit deferrals and never PASS evidence', () => {
  assert.deepEqual(PERFORMANCE_ACCEPTANCE_DEFERRALS.map(({ code, status }) => [code, status]), [
    ['PRODUCTION_BASELINE_AND_FORECAST_CAPACITY', 'DEFERRED'],
    ['NAMED_OWNER_ASSIGNMENTS_AND_APPROVALS', 'DEFERRED'],
    ['POST_ACTIVATION_THIRTY_DAY_ACCEPTANCE', 'DEFERRED'],
  ]);
  assert.ok(PERFORMANCE_ACCEPTANCE_DEFERRALS.every(({ promotionSatisfied }) => promotionSatisfied === false));
});

test('a release plan is promotion-ineligible unless all 100 iterations are requested', () => {
  const release = buildPerformanceAcceptancePlan({ mode: 'release' });
  assert.equal(release.raceIterations, 100);
  assert.equal(release.promotionEligible, false, 'approved deferrals continue to block promotion');
  assert.equal(release.productionActivationAuthorized, false);
  assert.throws(() => buildPerformanceAcceptancePlan({ mode: 'release', raceIterations: 99 }), /exactly 100/);

  const diagnostic = buildPerformanceAcceptancePlan({ mode: 'diagnostic', raceIterations: 1 });
  assert.equal(diagnostic.raceIterations, 1);
  assert.equal(diagnostic.promotionEligible, false);
  assert.equal(diagnostic.evidenceClassification, 'DIAGNOSTIC_ONLY');
});
