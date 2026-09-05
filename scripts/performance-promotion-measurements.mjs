// Acceptance decision #355. Ratios are fractions, durations are milliseconds.
const owners = ['HUMAN_RESOURCES', 'SECURITY_PRIVACY', 'SYSTEM_OWNER'];
const raceNames = [
  'double-submit', 'double-hr-decision', 'submit-context-change', 'accept-policy-activation',
  'accept-cancel-invalidate-pause', 'correction-expiry-recomputation', 'export-revoke-correction-hold',
  'deletion-legal-hold', 'cohort-pause-write', 'reconstruction-hr-write', 'unknown-response-after-commit', 'notification-export-retry',
];
const budgets = {
  badge: [200, 500], list: [500, 1000], draft: [750, 1500], decision: [1000, 2000],
  analytics: [1500, 3000], browser: [2000, 3000], reproduction: [500, 1000],
};
const finite = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const positive = (n) => finite(n) && n > 0;
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uniqueStrings = (items, minimum) => Array.isArray(items) && items.every((item) => typeof item === 'string' && item.trim()) && new Set(items).size >= minimum;
const complete = (items, names, predicate) => Array.isArray(items) && names.every((name) => {
  const matches = items.filter((item) => item?.name === name);
  return matches.length === 1 && predicate(matches[0]);
});
const zeroCritical = (result) => result?.openP0 === 0 && result.openP1 === 0;
const noIntegrityFailure = (result) => result?.disclosures === 0 && result.calculationMismatches === 0
  && result.duplicateResults === 0 && result.lostWrites === 0 && result.recoveryFailures === 0;
const approvalsValid = (approvals) => Array.isArray(approvals) && approvals.length === 3 && complete(approvals, owners, (approval) => approval.decision === 'APPROVE'
  && typeof approval.actorId === 'string' && approval.actorId.trim() && typeof approval.receiptHash === 'string'
  && /^[a-f0-9]{64}$/.test(approval.receiptHash)) && new Set(approvals.map(({ actorId }) => actorId)).size === 3;

const retirementMeasured = (result, observedAt) => {
  const activation = Date.parse(result.publicActivatedAt);
  const healthy = Date.parse(result.continuouslyHealthySince);
  return Number.isFinite(activation) && Number.isFinite(healthy) && healthy >= activation
    && Date.parse(observedAt) - healthy >= 30 * 86_400_000
    && result.allCohortsTransferred === true && result.legacyConsumers === 0 && result.legacyWriters === 0
    && result.reconciliationMismatches === 0 && zeroCritical(result)
    && uniqueStrings(result.successfulDeploymentIds, 2) && uniqueStrings(result.successfulRestoreIds, 2)
    && approvalsValid(result.approvals);
};

const capacityMeasured = (result) => {
  if (!/^[a-f0-9]{64}$/.test(result.baselineSnapshotHash) || !/^[a-f0-9]{64}$/.test(result.forecastSourceHash) || !positive(result.baselinePersonnel)
    || !positive(result.threeYearForecastPersonnel)) return false;
  return complete(result.profiles, ['Baseline', 'Growth', 'Stress'], (profile) => {
    const minimumPopulation = profile.name === 'Growth' ? result.threeYearForecastPersonnel * 3
      : result.baselinePersonnel * (profile.name === 'Stress' ? 10 : 1);
    if (!positive(profile.population) || profile.population < minimumPopulation || !positive(profile.concurrentUsers)
      || profile.concurrentUsers < 1000 || !positive(profile.requestsPerMinute) || profile.requestsPerMinute < 10000
      || !profile.seed || !profile.environment || !noIntegrityFailure(profile) || !zeroCritical(profile)
      || !positive(profile.sectionsPerEvaluation) || profile.sectionsPerEvaluation < 10
      || !positive(profile.criteriaPerEvaluation) || profile.criteriaPerEvaluation < 100
      || !positive(profile.evidenceLinksPerCriterion) || profile.evidenceLinksPerCriterion < 10
      || !positive(profile.acceptedHistoryYears) || profile.acceptedHistoryYears < 7
      || !positive(profile.rejectedHistoryYears) || profile.rejectedHistoryYears < 2) return false;
    if (profile.name !== 'Growth') return true;
    return profile.timeouts === 0 && finite(profile.serverErrorRate) && profile.serverErrorRate < 0.001
      && finite(profile.backgroundPoolFraction) && profile.backgroundPoolFraction <= 0.25
      && finite(profile.preview10000DurationMs) && profile.preview10000DurationMs <= 300000
      && finite(profile.reconciliationDurationMs) && profile.reconciliationDurationMs <= 1800000
      && complete(profile.operations, Object.keys(budgets), (operation) => {
        const [p95, p99] = budgets[operation.name];
        return positive(operation.samples) && Number.isInteger(operation.samples)
          && finite(operation.p50) && finite(operation.p95) && finite(operation.p99)
          && operation.p50 <= operation.p95 && operation.p95 <= operation.p99
          && operation.p95 <= p95 && operation.p99 <= p99;
      });
  });
};

const cohortMeasured = (result) => {
  const stages = { PILOT: [5, 10, 5], TEN_PERCENT: [5, 25, 10], TWENTY_FIVE_PERCENT: [7, 50, 25], FIFTY_PERCENT: [7, 100, 50], ALL: [10, 200, 100] };
  const required = stages[result.stage];
  return Boolean(required) && zeroCritical(result) && result.reconciliationMismatches === 0
    && result.sloPassed === true && result.hypercareAlertHeartbeatHealthy === true
    && finite(result.poolUtilization) && result.poolUtilization < 0.85
    && positive(result.healthyWorkingDays) && result.healthyWorkingDays >= required[0]
    && positive(result.availableSections) && positive(result.availableAcceptedResults)
    && positive(result.completedSections) && result.completedSections >= Math.min(required[1], result.availableSections)
    && result.completedSections <= result.availableSections
    && positive(result.acceptedResults) && result.acceptedResults >= Math.min(required[2], result.availableAcceptedResults)
    && result.acceptedResults <= result.availableAcceptedResults
    && result.realPilotEvidence === true && approvalsValid(result.approvals)
    && (result.stage !== 'PILOT' || (positive(result.readyPopulation) && result.members >= Math.min(10, result.readyPopulation)
      && result.members <= Math.min(25, result.readyPopulation)));
};

const validators = {
  'compatibility-retirement': retirementMeasured,
  'capacity-profiles': capacityMeasured,
  'cohort-promotion': cohortMeasured,
  'three-owner-approval': (result) => zeroCritical(result) && approvalsValid(result.approvals),
  'deterministic-races': (result) => result.database === 'PostgreSQL' && result.deterministicBarriers === true
    && complete(result.races, raceNames, (race) => Number.isInteger(race.iterations) && race.iterations >= 100
      && race.actors === 2 && race.failures === 0 && race.validTruthsPerIteration === 1
      && race.duplicateEvents === 0 && race.lostWrites === 0 && race.additionalDisclosures === 0 && race.loserBusinessResponse === true),
  'failure-injection': (result) => complete(result.scenarios,
    ['transaction', 'queue', 'storage', 'encryption', 'notification', 'migration', 'reconciliation', 'restore'],
    (scenario) => scenario.executed === true && scenario.failClosed === true && scenario.lostAcknowledgedWrites === 0),
  'browser-acceptance': (result) => result.realBrowser === true && result.realPersistence === true && result.roleActionScopeMatrixComplete === true
    && complete(result.viewports, ['360', '768', '1280', '1920'], (viewport) => viewport.rtl === true
      && viewport.light === true && viewport.dark === true && viewport.keyboard === true && viewport.focus === true && viewport.reducedMotion === true),
  'export-capacity': (result) => finite(result.requestP99Ms) && result.requestP99Ms <= 2000
    && finite(result.queueP95Ms) && result.queueP95Ms < 300000
    && complete(result.formats, ['Excel', 'PDF'], (format) => {
      const excel = format.name === 'Excel';
      return positive(format.samples) && finite(format.p95Ms) && format.p95Ms <= (excel ? 120000 : 180000)
        && finite(format.maximumDurationMs) && format.maximumDurationMs <= 300000
        && format.concurrentJobs === (excel ? 5 : 2) && format.units === (excel ? 100000 : 500)
        && format.megabytes === (excel ? 100 : 50) && format.partialArtifacts === 0;
    }),
  'runbook-rehearsal': (result) => result.fullEncryptedCheckpointRestored === true && result.rpoAcknowledgedWritesLost === 0
    && result.correctnessRehearsalPassed === true && result.timedDressRehearsalPassed === true
    && typeof result.operatorId === 'string' && Boolean(result.operatorId.trim()) && digest(result.runbookHash)
    && Array.isArray(result.dryRuns) && result.dryRuns.length >= 2
    && result.dryRuns.every((run) => Number.isInteger(run.count) && positive(run.count) && digest(run.hash) && run.hash === result.dryRuns[0].hash && run.count === result.dryRuns[0].count)
    && Number.isInteger(result.idempotentApplyReconciliations) && result.idempotentApplyReconciliations >= 3 && result.driftInjected === true && result.concurrentHrWriteRetried === true,
};

export const validatePromotionMeasurements = (check, measurements, observedAt) => {
  const validate = validators[check];
  return !validate || (measurements && validate(measurements, observedAt) === true);
};
