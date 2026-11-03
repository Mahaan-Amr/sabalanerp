import assert from 'node:assert/strict';
import {
  HrRedesignCutoverBlockedError,
  HR_REDESIGN_REQUIRED_ACCEPTANCE_GATES,
  assertHrRedesignCutoverDryRunDeterministic,
  assertHrRedesignReleaseAcceptance,
  assertHrRedesignCutoverReady,
} from '../hrRedesignCutover';
import {
  resolveHrRedesignCutoverStartup,
} from '../hrRedesignCutoverStartup';

const readyReport = {
  safeBackfills: [{ code: 'CATALOGS', count: 0 }],
  actionableConflicts: [{ code: 'CURRENT_HR_RECONCILIATION', count: 0 }],
  neutralLegacyOutcomes: [{ code: 'NO_LEGACY_ASSESSMENT_HISTORY', count: 12 }],
  blockingFailures: [],
  totals: {
    safeBackfills: 0,
    actionableConflicts: 0,
    neutralLegacyOutcomes: 12,
    blockingFailures: 0,
  },
  canCutOver: true,
};

assert.deepEqual(assertHrRedesignCutoverReady(readyReport), readyReport);

const readyAttestation = {
  issue: 245,
  sourceRevision: 'revision-245',
  verifiedAt: '2026-08-09T20:00:00.000Z',
  checks: Object.fromEntries(HR_REDESIGN_REQUIRED_ACCEPTANCE_GATES.map((gate) => [gate, 'PASSED'])),
};
assert.deepEqual(assertHrRedesignReleaseAcceptance(readyAttestation, 'revision-245'), readyAttestation);
assert.throws(
  () => assertHrRedesignReleaseAcceptance({
    ...readyAttestation,
    checks: { ...readyAttestation.checks, 'frontend-build': 'FAILED' },
  }, 'revision-245'),
  /frontend-build/,
);

assert.deepEqual(
  resolveHrRedesignCutoverStartup({}),
  { enabled: false, acceptancePath: null, sourceRevision: null },
  'production compatibility mode must start without a fabricated Cutover attestation',
);
assert.deepEqual(
  resolveHrRedesignCutoverStartup({
    HR_REDESIGN_CUTOVER_ENABLED: 'true',
    HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH: '/run/secrets/hr-redesign-acceptance.json',
    HR_REDESIGN_CUTOVER_REVISION: 'revision-245',
  }),
  {
    enabled: true,
    acceptancePath: '/run/secrets/hr-redesign-acceptance.json',
    sourceRevision: 'revision-245',
  },
);
assert.throws(
  () => resolveHrRedesignCutoverStartup({ HR_REDESIGN_CUTOVER_ENABLED: 'true' }),
  /HR_REDESIGN_CUTOVER_ACCEPTANCE_PATH, HR_REDESIGN_CUTOVER_REVISION/,
  'an explicitly enabled Cutover must remain fail-closed without its revision-bound attestation',
);
assert.throws(
  () => assertHrRedesignReleaseAcceptance(readyAttestation, 'different-revision'),
  /source revision/,
);
assert.deepEqual(assertHrRedesignCutoverDryRunDeterministic(readyReport, readyReport), readyReport);
assert.throws(
  () => assertHrRedesignCutoverDryRunDeterministic(
    readyReport,
    { ...readyReport, totals: { ...readyReport.totals, neutralLegacyOutcomes: 13 } },
  ),
  /not deterministic/,
);

for (const [gate, report] of [
  ['pending safe backfill', { ...readyReport, totals: { ...readyReport.totals, safeBackfills: 1 } }],
  ['actionable reconciliation conflict', { ...readyReport, totals: { ...readyReport.totals, actionableConflicts: 1 }, canCutOver: false }],
  ['blocking identity/configuration failure', { ...readyReport, totals: { ...readyReport.totals, blockingFailures: 1 }, canCutOver: false }],
] as const) {
  assert.throws(
    () => assertHrRedesignCutoverReady(report),
    (error: unknown) => error instanceof HrRedesignCutoverBlockedError
      && error.blockers.some((blocker) => blocker.count === 1),
    `Cutover must fail closed for ${gate}`,
  );
}

console.log('HR redesign Cutover gate tests passed.');
