export const PERSONNEL_PERFORMANCE_PHASES = [
  'SCHEMA_PROTECTION',
  'POLICY_DARK_LAUNCH',
  'READINESS',
  'SUPERVISOR_HR_PILOT',
  'RESULT_LEVEL_BADGE',
  'ANALYTICS_RANKING_CALIBRATION',
  'PDF_EXCEL_EXPORT',
  'CONSEQUENCE_HANDOFF',
  'EXPANSION_RETIREMENT',
] as const;

export type PersonnelPerformancePhase = typeof PERSONNEL_PERFORMANCE_PHASES[number];
export type PersonnelPerformanceWriteAction =
  | 'MANAGE_POLICY'
  | 'RECONSTRUCT_READINESS'
  | 'SAVE_SUPERVISOR_DRAFT'
  | 'SUBMIT_SUPERVISOR_EVALUATION'
  | 'DECIDE_HR_REVIEW'
  | 'PROJECT_CURRENT_LEVEL'
  | 'WRITE_ANALYTICS_PROJECTION'
  | 'REQUEST_EXPORT'
  | 'CREATE_CONSEQUENCE_HANDOFF'
  | 'APPEND_AUDIT_EVIDENCE'
  | 'RECONCILE_CANONICAL_STATE';

type PersonnelPerformanceRolloutState = {
  releaseEnabled: boolean;
  phase: PersonnelPerformancePhase;
  phaseVersion: number;
  cohortVersion: number;
  subjectInCohort: boolean;
  safetyPause: null | { id: string; scope: 'ALL' | 'COHORT' };
};

const minimumPhase: Record<PersonnelPerformanceWriteAction, PersonnelPerformancePhase> = {
  MANAGE_POLICY: 'POLICY_DARK_LAUNCH',
  RECONSTRUCT_READINESS: 'READINESS',
  SAVE_SUPERVISOR_DRAFT: 'SUPERVISOR_HR_PILOT',
  SUBMIT_SUPERVISOR_EVALUATION: 'SUPERVISOR_HR_PILOT',
  DECIDE_HR_REVIEW: 'SUPERVISOR_HR_PILOT',
  PROJECT_CURRENT_LEVEL: 'RESULT_LEVEL_BADGE',
  WRITE_ANALYTICS_PROJECTION: 'ANALYTICS_RANKING_CALIBRATION',
  REQUEST_EXPORT: 'PDF_EXCEL_EXPORT',
  CREATE_CONSEQUENCE_HANDOFF: 'CONSEQUENCE_HANDOFF',
  APPEND_AUDIT_EVIDENCE: 'SCHEMA_PROTECTION',
  RECONCILE_CANONICAL_STATE: 'SCHEMA_PROTECTION',
};

const pauseSafeActions = new Set<PersonnelPerformanceWriteAction>([
  'APPEND_AUDIT_EVIDENCE',
  'RECONCILE_CANONICAL_STATE',
]);

const cohortScopedActions = new Set<PersonnelPerformanceWriteAction>([
  'SAVE_SUPERVISOR_DRAFT',
  'SUBMIT_SUPERVISOR_EVALUATION',
  'DECIDE_HR_REVIEW',
  'PROJECT_CURRENT_LEVEL',
  'WRITE_ANALYTICS_PROJECTION',
  'REQUEST_EXPORT',
  'CREATE_CONSEQUENCE_HANDOFF',
]);

export type PersonnelPerformanceWriteGateDecision =
  | { allowed: true; phaseVersion: number; cohortVersion: number }
  | { allowed: false; reason: 'RELEASE_DISABLED' | 'CAPABILITY_NOT_ACTIVE' | 'SUBJECT_OUTSIDE_COHORT' | 'SAFETY_PAUSED' };

export const evaluatePersonnelPerformanceWriteGate = (
  state: PersonnelPerformanceRolloutState,
  action: PersonnelPerformanceWriteAction,
): PersonnelPerformanceWriteGateDecision => {
  if (!state.releaseEnabled) return { allowed: false, reason: 'RELEASE_DISABLED' };
  if (PERSONNEL_PERFORMANCE_PHASES.indexOf(state.phase) < PERSONNEL_PERFORMANCE_PHASES.indexOf(minimumPhase[action])) {
    return { allowed: false, reason: 'CAPABILITY_NOT_ACTIVE' };
  }
  if (cohortScopedActions.has(action) && !state.subjectInCohort) return { allowed: false, reason: 'SUBJECT_OUTSIDE_COHORT' };
  if (state.safetyPause && !pauseSafeActions.has(action)) return { allowed: false, reason: 'SAFETY_PAUSED' };
  return { allowed: true, phaseVersion: state.phaseVersion, cohortVersion: state.cohortVersion };
};

export const personnelPerformanceRollbackMode = (hasCanonicalWrite: boolean) => (
  hasCanonicalWrite ? 'EVIDENCE_PRESERVING_FIX_FORWARD' : 'COMPATIBLE_RELEASE_DISABLE'
);
