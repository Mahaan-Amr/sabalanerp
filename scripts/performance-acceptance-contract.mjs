import { validatePromotionMeasurements } from './performance-promotion-measurements.mjs';

const invariants = Object.freeze([
  'ONE_VALID_TRUTH',
  'NO_LOST_WRITE',
  'NO_DUPLICATE_EVENT_OR_RESULT',
  'NO_ADDITIONAL_DISCLOSURE',
  'LOSER_HAS_BUSINESS_RESPONSE',
]);

const race = (name, publicBoundary) => Object.freeze({
  name,
  publicBoundary,
  actors: 2,
  iterations: 100,
  invariants,
});

export const PERFORMANCE_ACCEPTANCE_RACES = Object.freeze([
  race('double-submit', 'submitSupervisorPerformanceSection'),
  race('double-hr-decision', 'decidePerformanceReview'),
  race('submit-context-change', 'submitSupervisorPerformanceSection / effective assignment and responsibility writes'),
  race('accept-policy-activation', 'decidePerformanceReview / activateDuePerformanceArtifacts'),
  race('accept-cancel-invalidate-pause', 'decidePerformanceReview / lifecycle and safety-pause services'),
  race('correction-expiry-recomputation', 'performance correction / expiry / result reproduction services'),
  race('export-revoke-correction-hold', 'performance export / authorization / correction / legal-hold services'),
  race('deletion-legal-hold', 'executePerformanceErasureOperation / placePerformanceLegalHold'),
  race('cohort-pause-write', 'cohort activation / pausePersonnelPerformance / canonical write admission'),
  race('reconstruction-hr-write', 'reconstructPerformanceReadiness / canonical HR effective-dated writes'),
  race('unknown-response-after-commit', 'idempotent workflow command retry'),
  race('notification-export-retry', 'notification outbox / performance export job retry'),
]);

export const PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS = Object.freeze([
  'transaction', 'queue', 'storage', 'encryption', 'notification', 'migration', 'reconciliation', 'restore',
]);

export const PERFORMANCE_ACCEPTANCE_LANES = Object.freeze([
  'integrated-regression',
  'twelve-races',
  'failure-recovery',
  'permission-nondisclosure',
  'browser-matrix',
  'export-capacity',
]);

const integratedChecks = Object.freeze([
  'backend-build', 'frontend-build', 'lint', 'architecture', 'design-system',
  'performance-unit', 'performance-foundation-database', 'performance-policy-database',
  'performance-workflow-database', 'performance-disclosure-database', 'performance-operations-database',
]);

const nondisclosureScenarios = Object.freeze([
  'role-workspace-feature-action-scope-effective-time', 'personnel-without-user',
  'supervisor-without-authority', 'no-hr-proxy', 'self-evaluation-denied',
  'authorized-subordinate-self-review-audited', 'typed-applicability-unknown-blocked',
  'five-level-disclosure-chain', 'identity-verified-summary-delivery',
  'no-score-criteria-narrative-rank-leak', 'privacy-correction-boundary',
  'manual-consequence-boundary', 'catalog-import-composition-recovery',
  'personnel-inventory-reemployment-boundaries', 'security-negative-matrix',
]);

const completeNamedPasses = (items, required) => Array.isArray(items) && items.length === required.length
  && required.every((name) => items.filter((item) => item?.name === name && item.status === 'PASS').length === 1);
const exactNamedMeasurements = (items, required) => Array.isArray(items) && items.length === required.length
  && required.every((name) => items.filter((item) => item?.name === name).length === 1);

export const validatePerformanceAcceptanceLane = (lane, measurements, observedAt, infrastructureHash) => {
  if (lane === 'integrated-regression') {
    return completeNamedPasses(measurements?.checks, integratedChecks)
      && measurements.openP0 === 0 && measurements.openP1 === 0 && measurements.skipped === 0;
  }
  if (lane === 'twelve-races') {
    return exactNamedMeasurements(measurements?.races, PERFORMANCE_ACCEPTANCE_RACES.map(({ name }) => name))
      && validatePromotionMeasurements('deterministic-races', measurements, observedAt, infrastructureHash);
  }
  if (lane === 'failure-recovery') {
    return exactNamedMeasurements(measurements?.failureInjection?.scenarios, PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS)
      && validatePromotionMeasurements('failure-injection', measurements?.failureInjection, observedAt, infrastructureHash)
      && validatePromotionMeasurements('runbook-rehearsal', measurements?.runbookRehearsal, observedAt, infrastructureHash);
  }
  if (lane === 'permission-nondisclosure') {
    return completeNamedPasses(measurements?.scenarios, nondisclosureScenarios)
      && measurements.permissionBranchesCoveredPercent === 100
      && measurements.additionalDisclosures === 0 && measurements.openP0 === 0 && measurements.openP1 === 0;
  }
  if (lane === 'browser-matrix') {
    return exactNamedMeasurements(measurements?.viewports, PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX.viewports.map(String))
      && Array.isArray(measurements?.securityNegativeMatrix)
      && measurements.securityNegativeMatrix.length === PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES.length
      && PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES.every((name) => measurements.securityNegativeMatrix.includes(name))
      && validatePromotionMeasurements('browser-acceptance', measurements, observedAt, infrastructureHash);
  }
  if (lane === 'export-capacity') {
    return exactNamedMeasurements(measurements?.formats, ['Excel', 'PDF'])
      && validatePromotionMeasurements('export-capacity', measurements, observedAt, infrastructureHash);
  }
  return false;
};

export const PERFORMANCE_ACCEPTANCE_INTEGRATED_CHECKS = integratedChecks;
export const PERFORMANCE_ACCEPTANCE_NONDISCLOSURE_SCENARIOS = nondisclosureScenarios;
export const PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES = Object.freeze([
  'persisted-route-identifier-enumeration-equivalence',
  'persisted-route-search-count-placeholder-nondisclosure',
  'browser-cache-no-store',
  'persisted-malicious-text-inert-browser-rendering',
]);

export const PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX = Object.freeze({
  viewports: Object.freeze([360, 390, 768, 1280, 1920]),
  themes: Object.freeze(['light', 'dark']),
  interactionModes: Object.freeze(['keyboard', 'focus', 'reduced-motion', 'zoom-200']),
  direction: 'rtl',
  persistence: 'REAL_LOCAL_POSTGRESQL',
});

export const PERFORMANCE_ACCEPTANCE_DEFERRALS = Object.freeze([
  Object.freeze({
    code: 'PRODUCTION_BASELINE_AND_FORECAST_CAPACITY',
    status: 'DEFERRED',
    promotionSatisfied: false,
  }),
  Object.freeze({
    code: 'NAMED_OWNER_ASSIGNMENTS_AND_APPROVALS',
    status: 'DEFERRED',
    promotionSatisfied: false,
  }),
  Object.freeze({
    code: 'POST_ACTIVATION_THIRTY_DAY_ACCEPTANCE',
    status: 'DEFERRED',
    promotionSatisfied: false,
  }),
]);

const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const validPerformanceCandidateIdentityShape = (identity) => Boolean(identity
  && /^[a-f0-9]{40}$/.test(identity.commit)
  && ['sourceHash', 'schemaHash', 'policyHash', 'infrastructureHash'].every((key) => digest(identity[key]))
  && ['backend', 'frontend', 'inquiry'].every((key) => /^sha256:[a-f0-9]{64}$/.test(identity.images?.[key]))
  && identity.runtimeSourceBinding?.status === 'ATTESTED'
  && digest(identity.runtimeSourceBinding.evidenceHash)
  && typeof identity.runtimeSourceBinding.keyId === 'string'
  && identity.runtimeSourceBinding.algorithm === 'Ed25519'
  && typeof identity.runtimeSourceBinding.signature === 'string');

export const buildPerformanceAcceptancePlan = ({ mode = 'release', raceIterations } = {}) => {
  if (!['release', 'diagnostic'].includes(mode)) throw new Error('Acceptance mode must be release or diagnostic');
  const iterations = raceIterations ?? (mode === 'release' ? 100 : 1);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new Error('Acceptance race iterations must be an integer from 1 to 100');
  }
  if (mode === 'release' && iterations !== 100) {
    throw new Error('Release acceptance requires exactly 100 iterations for every race');
  }
  return Object.freeze({
    schemaVersion: 1,
    contract: 'PERSONNEL_PERFORMANCE_ACCEPTANCE_V1',
    mode,
    raceIterations: iterations,
    evidenceClassification: mode === 'release' ? 'RELEASE_BOUND_ACCEPTANCE' : 'DIAGNOSTIC_ONLY',
    races: PERFORMANCE_ACCEPTANCE_RACES,
    failureScenarios: PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS,
    browserMatrix: PERFORMANCE_ACCEPTANCE_BROWSER_MATRIX,
    deferrals: PERFORMANCE_ACCEPTANCE_DEFERRALS,
    promotionEligible: false,
    productionActivationAuthorized: false,
  });
};
