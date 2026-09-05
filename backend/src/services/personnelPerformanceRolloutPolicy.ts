import type { Prisma, PrismaClient } from '@prisma/client';

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
  | 'MANAGE_PERFORMANCE_CYCLE'
  | 'SEND_WORKFLOW_REMINDERS'
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
  MANAGE_PERFORMANCE_CYCLE: 'SUPERVISOR_HR_PILOT',
  SEND_WORKFLOW_REMINDERS: 'SUPERVISOR_HR_PILOT',
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
  'MANAGE_PERFORMANCE_CYCLE',
  'PROJECT_CURRENT_LEVEL',
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

export const resolvePersonnelPerformanceWriteGate = async (
  client: PrismaClient | Prisma.TransactionClient,
  action: PersonnelPerformanceWriteAction,
  now = new Date(),
  subjectId?: string,
) => {
  const phase = await client.performanceFeaturePhaseVersion.findFirst({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  const cohort = phase?.cohortVersionId ? await client.performanceCohortVersion.findUnique({
    where: { id: phase.cohortVersionId, lifecycle: 'ACTIVE', effectiveFrom: { lte: now } }, select: { id: true, version: true },
  }) : null;
  const membership = cohort && subjectId ? await client.performanceCohortMember.findUnique({
    where: { cohortVersionId_subjectId: { cohortVersionId: cohort.id, subjectId } }, select: { id: true },
  }) : null;
  const pause = await findApplicablePerformancePause(client, subjectId);
  return evaluatePersonnelPerformanceWriteGate({
    releaseEnabled: phase?.releaseEnabled ?? false,
    phase: phase?.phase ?? 'SCHEMA_PROTECTION',
    phaseVersion: phase?.version ?? 0,
    cohortVersion: cohort?.version ?? 0,
    subjectInCohort: Boolean(membership),
    safetyPause: pause
      ? { id: pause.id, scope: pause.scope === 'COHORT' ? 'COHORT' : 'ALL' }
      : null,
  }, action);
};

/** Call inside the writer's transaction before taking narrower aggregate locks or resolving authority. */
export const assertPersonnelPerformanceWriteAdmission = async (
  tx: Prisma.TransactionClient, action: PersonnelPerformanceWriteAction, subjectId?: string,
) => {
  const fence = await tx.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  if (!fence.length) throw Object.assign(new Error('وضعیت انتشار عملکرد در دسترس نیست.'), { code: 'PERFORMANCE_OPERATIONS_FENCE_UNAVAILABLE', status: 409 });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const decision = await resolvePersonnelPerformanceWriteGate(tx, action, clock.now, subjectId);
  if (!decision.allowed) throw Object.assign(new Error('عملیات با مرحله انتشار یا عضویت فعلی مجاز نیست.'), {
    code: `PERFORMANCE_${decision.reason}`, status: 409,
  });
  return decision;
};

export const personnelPerformanceRollbackMode = (hasCanonicalWrite: boolean) => (
  hasCanonicalWrite ? 'EVIDENCE_PRESERVING_FIX_FORWARD' : 'COMPATIBLE_RELEASE_DISABLE'
);

export const findApplicablePerformancePause = async (
  client: PrismaClient | Prisma.TransactionClient,
  subjectId?: string,
) => {
  // A pause survives phase and membership version changes until explicitly resumed.
  const memberships = subjectId ? await client.performanceCohortMember.findMany({
    where: { subjectId }, select: { cohortVersionId: true },
  }) : [];
  return client.performanceSafetyPause.findFirst({
    where: {
      status: 'ACTIVE',
      ...(subjectId ? { OR: [
        { scope: 'ALL' },
        { scope: 'COHORT', cohortVersionId: { in: memberships.map(({ cohortVersionId }) => cohortVersionId) } },
      ] } : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
};

export const isPerformanceTransactionConflict = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('code' in error.meta)) return false;
  return ['40001', '40P01'].includes(String(error.meta.code));
};

export const normalizePerformanceWriteError = (error: unknown): unknown => {
  if (isPerformanceTransactionConflict(error)) return Object.assign(new Error('وضعیت هم‌زمان تغییر کرده است؛ درخواست را دوباره ارسال کنید.'), { code: 'PERFORMANCE_WRITE_RETRY_REQUIRED', status: 409 });
  const message = error instanceof Error ? error.message : '';
  const codes = ['PERFORMANCE_SAFETY_PAUSED', 'PERFORMANCE_RELEASE_DISABLED', 'PERFORMANCE_FIX_FORWARD_REQUIRED', 'PERFORMANCE_CAPABILITY_NOT_ACTIVE'] as const;
  const code = codes.find((candidate) => message.includes(candidate));
  return code ? Object.assign(new Error('عملیات با وضعیت فعلی انتشار عملکرد مجاز نیست.'), { code, status: 409 }) : error;
};
