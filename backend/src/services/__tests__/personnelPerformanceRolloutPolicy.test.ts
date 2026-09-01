import assert from 'node:assert/strict';
import {
  evaluatePersonnelPerformanceWriteGate,
  personnelPerformanceRollbackMode,
} from '../personnelPerformanceRolloutPolicy';

const activePilot = {
  releaseEnabled: true,
  phase: 'SUPERVISOR_HR_PILOT' as const,
  phaseVersion: 4,
  cohortVersion: 2,
  subjectInCohort: true,
  safetyPause: null,
};

assert.deepEqual(evaluatePersonnelPerformanceWriteGate(activePilot, 'SAVE_SUPERVISOR_DRAFT'), {
  allowed: true,
  phaseVersion: 4,
  cohortVersion: 2,
});

for (const [name, state, reason] of [
  ['release off', { ...activePilot, releaseEnabled: false }, 'RELEASE_DISABLED'],
  ['outside cohort', { ...activePilot, subjectInCohort: false }, 'SUBJECT_OUTSIDE_COHORT'],
  ['phase too early', { ...activePilot, phase: 'READINESS' as const }, 'CAPABILITY_NOT_ACTIVE'],
  ['paused', { ...activePilot, safetyPause: { id: 'pause-1', scope: 'ALL' as const } }, 'SAFETY_PAUSED'],
] as const) {
  assert.deepEqual(evaluatePersonnelPerformanceWriteGate(state, 'SAVE_SUPERVISOR_DRAFT'), {
    allowed: false,
    reason,
  }, name);
}

assert.deepEqual(
  evaluatePersonnelPerformanceWriteGate({ ...activePilot, safetyPause: { id: 'pause-1', scope: 'ALL' } }, 'APPEND_AUDIT_EVIDENCE'),
  { allowed: true, phaseVersion: 4, cohortVersion: 2 },
  'safe pause preserves append-only evidence writes',
);
assert.deepEqual(
  evaluatePersonnelPerformanceWriteGate({ ...activePilot, safetyPause: { id: 'pause-1', scope: 'ALL' } }, 'RECONCILE_CANONICAL_STATE'),
  { allowed: true, phaseVersion: 4, cohortVersion: 2 },
  'safe pause permits repair through the canonical reconciliation path',
);

assert.deepEqual(
  evaluatePersonnelPerformanceWriteGate({ ...activePilot, phase: 'READINESS', subjectInCohort: false }, 'RECONSTRUCT_READINESS'),
  { allowed: true, phaseVersion: 4, cohortVersion: 2 },
  'readiness reconstruction determines cohort eligibility and therefore runs before membership',
);
assert.deepEqual(
  evaluatePersonnelPerformanceWriteGate({ ...activePilot, phase: 'POLICY_DARK_LAUNCH', subjectInCohort: false }, 'MANAGE_POLICY'),
  { allowed: true, phaseVersion: 4, cohortVersion: 2 },
  'dark-launch policy administration is not scoped by a subject cohort',
);

assert.equal(personnelPerformanceRollbackMode(false), 'COMPATIBLE_RELEASE_DISABLE');
assert.equal(personnelPerformanceRollbackMode(true), 'EVIDENCE_PRESERVING_FIX_FORWARD');

console.log('Personnel performance rollout policy tests passed.');
