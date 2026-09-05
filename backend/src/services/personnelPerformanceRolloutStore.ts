import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';

type Client = PrismaClient | Prisma.TransactionClient;
type OwnerType = 'HUMAN_RESOURCES' | 'SECURITY_PRIVACY' | 'SYSTEM_OWNER';
type Stage = 'PILOT' | 'TEN_PERCENT' | 'TWENTY_FIVE_PERCENT' | 'FIFTY_PERCENT' | 'ALL';

const ownerPermission: Record<OwnerType, { cohort: string; resume: string }> = {
  HUMAN_RESOURCES: { cohort: 'APPROVE_PERFORMANCE_COHORT_HR', resume: 'APPROVE_PERFORMANCE_RESUME_HR' },
  SECURITY_PRIVACY: { cohort: 'APPROVE_PERFORMANCE_COHORT_SECURITY', resume: 'APPROVE_PERFORMANCE_RESUME_SECURITY' },
  SYSTEM_OWNER: { cohort: 'APPROVE_PERFORMANCE_COHORT_SYSTEM', resume: 'APPROVE_PERFORMANCE_RESUME_SYSTEM' },
};
const stagePercent: Record<Stage, number> = {
  PILOT: 10, TEN_PERCENT: 10, TWENTY_FIVE_PERCENT: 25, FIFTY_PERCENT: 50, ALL: 100,
};
const rolloutError = (code: string, status = 409) => Object.assign(new Error('اقدام فعال‌سازی با شواهد، اختیار یا وضعیت فعلی مجاز نیست.'), { code, status });
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validReason = (value: string) => /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
const validDate = (value: Date) => value instanceof Date && Number.isFinite(value.getTime());
const validOwnerType = (value: string): value is OwnerType => Object.prototype.hasOwnProperty.call(ownerPermission, value);

const appendRolloutAudit = async (tx: Prisma.TransactionClient, input: {
  aggregateType: string; aggregateId: string; eventType: string; actorUserId: string | null;
  reason: string; authorityHash: string; evidence: unknown;
}) => {
  const id = randomUUID();
  await tx.performanceAuditEvent.create({ data: {
    id, aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType,
    actorUserId: input.actorUserId, reason: input.reason, authorityHash: input.authorityHash,
    eventHash: canonicalPerformanceHash({ id, evidence: input.evidence }),
  } });
};

const requirePermission = async (tx: Prisma.TransactionClient, actorUserId: string, permission: string) => {
  const permissions = await activeHrActionPermissionsForUser(tx, actorUserId);
  if (!permissions.includes(permission)) throw rolloutError('PERFORMANCE_ROLLOUT_PERMISSION_REQUIRED', 403);
  return canonicalPerformanceHash({ actorUserId, permission, effectivePermissions: permissions.sort() });
};

export const recordPerformanceTrainingEvidence = async (client: Client, input: {
  actorUserId: string; subjectId: string; curriculumHash: string; evidenceHash: string; completedAt: Date; validUntil: Date;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const authorityHash = await requirePermission(tx, input.actorUserId, 'RECORD_PERFORMANCE_TRAINING');
  if (!validHash(input.curriculumHash) || !validHash(input.evidenceHash) || !validDate(input.completedAt)
    || !validDate(input.validUntil) || input.completedAt > input.validUntil) throw rolloutError('PERFORMANCE_TRAINING_EVIDENCE_INVALID', 422);
  const subject = await tx.performanceSubject.findUnique({ where: { id: input.subjectId } });
  if (!subject || subject.identityDetachedAt) throw rolloutError('PERFORMANCE_TRAINING_SUBJECT_UNAVAILABLE', 404);
  const evidence = await tx.performanceTrainingEvidence.create({ data: {
    subjectId: input.subjectId, curriculumHash: input.curriculumHash, evidenceHash: input.evidenceHash,
    completedAt: input.completedAt, validUntil: input.validUntil, recordedByUserId: input.actorUserId,
  } });
  const id = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'PERFORMANCE_TRAINING_EVIDENCE', aggregateId: evidence.id,
    eventType: 'PERFORMANCE_TRAINING_RECORDED', actorUserId: input.actorUserId, authorityHash,
    eventHash: canonicalPerformanceHash({ id, subjectId: input.subjectId, curriculumHash: input.curriculumHash,
      evidenceHash: input.evidenceHash, completedAt: input.completedAt, validUntil: input.validUntil }) } });
  return evidence;
});

export const proposePerformanceCohort = async (client: Client, input: {
  actorUserId: string; cohortKey: string; stage: Stage; subjectIds: string[]; readinessHash: string; reason: string; now?: Date;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const authorityHash = await requirePermission(tx, input.actorUserId, 'MANAGE_PERFORMANCE_ROLLOUT');
  const subjectIds = [...new Set(input.subjectIds)].sort();
  const now = input.now ?? new Date();
  if (!input.cohortKey.trim() || !subjectIds.length || subjectIds.length > 10_000 || !validHash(input.readinessHash)
    || input.reason.trim().length < 8 || input.reason.length > 2_000 || !Object.prototype.hasOwnProperty.call(stagePercent, input.stage)) {
    throw rolloutError('PERFORMANCE_COHORT_PROPOSAL_INVALID', 422);
  }
  const subjects = await tx.performanceSubject.findMany({ where: { id: { in: subjectIds }, identityDetachedAt: null,
    employmentRelationshipId: { not: null } }, select: { id: true, employmentRelationshipId: true } });
  if (subjects.length !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_NOT_READY');
  const relationships = await tx.hrEmploymentRelationship.findMany({ where: { id: { in: subjects.map(({ employmentRelationshipId }) => employmentRelationshipId!) },
    status: { in: ['ACTIVE', 'SUSPENDED'] }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, select: { id: true } });
  if (relationships.length !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_NOT_READY');
  const evaluations = await tx.performanceEvaluation.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true, subjectId: true } });
  const readiness = await tx.performanceReadinessRecord.findMany({ where: { evaluationId: { in: evaluations.map(({ id }) => id) }, status: 'APPLIED' }, select: { evaluationId: true, runId: true } });
  const completedRuns = await tx.performanceReadinessRun.findMany({ where: { id: { in: readiness.map(({ runId }) => runId) }, status: 'COMPLETED', driftDetected: false }, select: { id: true, sourceHash: true } });
  const completedRunIds = new Set(completedRuns.map(({ id }) => id));
  const readyEvaluations = new Set(readiness.filter(({ runId }) => completedRunIds.has(runId)).map(({ evaluationId }) => evaluationId));
  const readySubjects = new Set(evaluations.filter(({ id }) => readyEvaluations.has(id)).map(({ subjectId }) => subjectId));
  if (readySubjects.size !== subjectIds.length || canonicalPerformanceHash(completedRuns.map(({ sourceHash }) => sourceHash).sort()) !== input.readinessHash) {
    throw rolloutError('PERFORMANCE_COHORT_READINESS_UNVERIFIED');
  }
  const training = await tx.performanceTrainingEvidence.findMany({ where: { subjectId: { in: subjectIds }, completedAt: { lte: now }, validUntil: { gt: now } },
    orderBy: [{ subjectId: 'asc' }, { completedAt: 'desc' }] });
  if (new Set(training.map(({ subjectId }) => subjectId)).size !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_TRAINING_MISSING');
  const previous = await tx.performanceCohortVersion.findFirst({ where: { cohortKey: input.cohortKey }, orderBy: { version: 'desc' } });
  const cohort = await tx.performanceCohortVersion.create({ data: { cohortKey: input.cohortKey, version: (previous?.version ?? 0) + 1,
    predecessorId: previous?.id, membershipHash: canonicalPerformanceHash(subjectIds), stage: input.stage,
    targetPercent: stagePercent[input.stage], readinessHash: input.readinessHash, activationReason: input.reason.trim(), createdByUserId: input.actorUserId } });
  await tx.performanceCohortMember.createMany({ data: subjectIds.map((subjectId) => ({ cohortVersionId: cohort.id, subjectId,
    eligibilityHash: canonicalPerformanceHash({ subjectId, readinessHash: input.readinessHash,
      trainingEvidenceIds: training.filter((row) => row.subjectId === subjectId).map(({ id }) => id).sort() }) })) });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_COHORT_VERSION', aggregateId: cohort.id,
    eventType: 'PERFORMANCE_COHORT_PROPOSED', actorUserId: input.actorUserId, reason: input.reason.trim(), authorityHash,
    evidence: { cohortId: cohort.id, cohortKey: cohort.cohortKey, version: cohort.version, stage: cohort.stage,
      membershipHash: cohort.membershipHash, readinessHash: cohort.readinessHash } });
  return cohort;
});

export const decidePerformanceRollout = async (client: Client, input: {
  actorUserId: string; scopeType: 'COHORT' | 'SAFETY_PAUSE'; scopeId: string; ownerType: OwnerType;
  action: 'APPROVE' | 'VETO' | 'APPROVE_RESUME'; reasonCode: string; evidenceHash: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const expectedAction = input.scopeType === 'COHORT' ? ['APPROVE', 'VETO'] : ['APPROVE_RESUME'];
  if (!validOwnerType(input.ownerType) || !expectedAction.includes(input.action) || !validReason(input.reasonCode) || !validHash(input.evidenceHash)) {
    throw rolloutError('PERFORMANCE_ROLLOUT_DECISION_INVALID', 422);
  }
  const permission = input.scopeType === 'COHORT' ? ownerPermission[input.ownerType].cohort : ownerPermission[input.ownerType].resume;
  const authorityHash = await requirePermission(tx, input.actorUserId, permission);
  const scope = input.scopeType === 'COHORT'
    ? await tx.performanceCohortVersion.findUnique({ where: { id: input.scopeId } })
    : await tx.performanceSafetyPause.findUnique({ where: { id: input.scopeId } });
  if (!scope) throw rolloutError('PERFORMANCE_ROLLOUT_SCOPE_UNAVAILABLE', 404);
  const previous = await tx.performanceRolloutDecision.findFirst({ where: { scopeType: input.scopeType, scopeId: input.scopeId,
    ownerType: input.ownerType }, orderBy: { version: 'desc' } });
  return tx.performanceRolloutDecision.create({ data: { ...input, version: (previous?.version ?? 0) + 1, authorityHash } });
});

const currentApprovals = async (tx: Prisma.TransactionClient, scopeType: 'COHORT' | 'SAFETY_PAUSE', scopeId: string) => {
  const decisions = await tx.performanceRolloutDecision.findMany({ where: { scopeType, scopeId }, orderBy: [{ ownerType: 'asc' }, { version: 'desc' }] });
  const latestByOwner = new Map<string, typeof decisions[number]>();
  for (const row of decisions) if (!latestByOwner.has(row.ownerType)) latestByOwner.set(row.ownerType, row);
  const latest = [...latestByOwner.values()];
  const action = scopeType === 'COHORT' ? 'APPROVE' : 'APPROVE_RESUME';
  if (latest.length !== 3 || latest.some((row) => row.action !== action) || new Set(latest.map(({ actorUserId }) => actorUserId)).size !== 3) {
    throw rolloutError('PERFORMANCE_ROLLOUT_APPROVALS_INCOMPLETE');
  }
  for (const row of latest) {
    const permission = scopeType === 'COHORT' ? ownerPermission[row.ownerType as OwnerType].cohort : ownerPermission[row.ownerType as OwnerType].resume;
    if (!(await activeHrActionPermissionsForUser(tx, row.actorUserId)).includes(permission)) throw rolloutError('PERFORMANCE_ROLLOUT_APPROVAL_EXPIRED');
  }
  return latest;
};

const assertCohortEligibility = async (tx: Prisma.TransactionClient, cohort: {
  id: string; membershipHash: string; readinessHash: string | null;
}, now: Date) => {
  const members = await tx.performanceCohortMember.findMany({ where: { cohortVersionId: cohort.id }, select: { subjectId: true } });
  const subjectIds = members.map(({ subjectId }) => subjectId).sort();
  if (!subjectIds.length || canonicalPerformanceHash(subjectIds) !== cohort.membershipHash || !cohort.readinessHash) {
    throw rolloutError('PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED');
  }
  const subjects = await tx.performanceSubject.findMany({ where: { id: { in: subjectIds }, identityDetachedAt: null,
    employmentRelationshipId: { not: null } }, select: { id: true, employmentRelationshipId: true } });
  if (subjects.length !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED');
  const relationships = await tx.hrEmploymentRelationship.findMany({ where: {
    id: { in: subjects.map(({ employmentRelationshipId }) => employmentRelationshipId!) }, status: { in: ['ACTIVE', 'SUSPENDED'] },
    effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  }, select: { id: true } });
  if (relationships.length !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED');
  const training = await tx.performanceTrainingEvidence.findMany({ where: { subjectId: { in: subjectIds }, completedAt: { lte: now }, validUntil: { gt: now } },
    select: { subjectId: true } });
  if (new Set(training.map(({ subjectId }) => subjectId)).size !== subjectIds.length) throw rolloutError('PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED');
  const evaluations = await tx.performanceEvaluation.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true, subjectId: true } });
  const readiness = await tx.performanceReadinessRecord.findMany({ where: { evaluationId: { in: evaluations.map(({ id }) => id) }, status: 'APPLIED' },
    select: { evaluationId: true, runId: true } });
  const runs = await tx.performanceReadinessRun.findMany({ where: { id: { in: readiness.map(({ runId }) => runId) }, status: 'COMPLETED', driftDetected: false },
    select: { id: true, sourceHash: true } });
  const runIds = new Set(runs.map(({ id }) => id));
  const readyEvaluations = new Set(readiness.filter(({ runId }) => runIds.has(runId)).map(({ evaluationId }) => evaluationId));
  if (new Set(evaluations.filter(({ id }) => readyEvaluations.has(id)).map(({ subjectId }) => subjectId)).size !== subjectIds.length
    || canonicalPerformanceHash(runs.map(({ sourceHash }) => sourceHash).sort()) !== cohort.readinessHash) {
    throw rolloutError('PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED');
  }
};

export const activatePerformanceCohort = async (client: Client, input: {
  actorUserId: string; cohortVersionId: string; effectiveFrom: Date; reason: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  await requirePermission(tx, input.actorUserId, 'TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT');
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const cohort = await tx.performanceCohortVersion.findUnique({ where: { id: input.cohortVersionId } });
  if (!cohort || cohort.lifecycle !== 'DRAFT' || !cohort.stage || !validDate(input.effectiveFrom)
    || input.effectiveFrom < clock.now || input.reason.trim().length < 8) throw rolloutError('PERFORMANCE_COHORT_ACTIVATION_INVALID', 422);
  const approvals = await currentApprovals(tx, 'COHORT', cohort.id);
  const latestPhase = await tx.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
  const scheduled = await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'SCHEDULED', effectiveFrom: input.effectiveFrom,
    activationReason: input.reason.trim(), activatedByUserId: input.actorUserId } });
  await tx.performanceFeaturePhaseVersion.create({ data: { version: (latestPhase?.version ?? 0) + 1, predecessorId: latestPhase?.id,
    phase: latestPhase?.phase ?? 'SUPERVISOR_HR_PILOT', releaseEnabled: true, cohortVersionId: cohort.id,
    effectiveFrom: input.effectiveFrom, recordedByUserId: input.actorUserId,
    reason: `${input.reason.trim()} | ${canonicalPerformanceHash(approvals.map(({ id }) => id).sort())}` } });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_COHORT_VERSION', aggregateId: cohort.id,
    eventType: 'PERFORMANCE_COHORT_SCHEDULED', actorUserId: input.actorUserId, reason: input.reason.trim(),
    authorityHash: canonicalPerformanceHash({ actorUserId: input.actorUserId, approvalIds: approvals.map(({ id }) => id).sort() }),
    evidence: { cohortId: cohort.id, effectiveFrom: input.effectiveFrom, approvalIds: approvals.map(({ id }) => id).sort() } });
  return scheduled;
});

export const activateDuePerformanceCohorts = async (client: Client, now = new Date()) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const due = await tx.performanceCohortVersion.findMany({ where: { lifecycle: 'SCHEDULED', effectiveFrom: { lte: now }, stage: { not: null } },
    orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
  const activated: Array<typeof due[number]> = [];
  for (const cohort of due) {
    const approvals = await currentApprovals(tx, 'COHORT', cohort.id);
    await assertCohortEligibility(tx, cohort, now);
    await tx.performanceCohortVersion.updateMany({ where: { cohortKey: cohort.cohortKey, lifecycle: 'ACTIVE', id: { not: cohort.id } },
      data: { lifecycle: 'RETIRED' } });
    const active = await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'ACTIVE' } });
    await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_COHORT_VERSION', aggregateId: cohort.id,
      eventType: 'PERFORMANCE_COHORT_ACTIVATED', actorUserId: null, reason: 'SCHEDULED_ACTIVATION',
      authorityHash: canonicalPerformanceHash({ system: 'PERSONNEL_PERFORMANCE_MAINTENANCE', approvalIds: approvals.map(({ id }) => id).sort() }),
      evidence: { cohortId: cohort.id, effectiveFrom: cohort.effectiveFrom, activatedAt: now } });
    activated.push(active);
  }
  return activated;
});

export const resumePersonnelPerformance = async (client: Client, input: {
  actorUserId: string; pauseId: string; reasonCode: string; evidenceHash: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  await requirePermission(tx, input.actorUserId, 'TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT');
  if (!validReason(input.reasonCode) || !validHash(input.evidenceHash)) throw rolloutError('PERFORMANCE_RESUME_INVALID', 422);
  const pause = await tx.performanceSafetyPause.findUnique({ where: { id: input.pauseId } });
  if (!pause || pause.status !== 'ACTIVE') throw rolloutError('PERFORMANCE_RESUME_INVALID', 422);
  const approvals = await currentApprovals(tx, 'SAFETY_PAUSE', pause.id);
  if (new Set(approvals.map(({ evidenceHash }) => evidenceHash)).size !== 1 || approvals[0].evidenceHash !== input.evidenceHash) {
    throw rolloutError('PERFORMANCE_RESUME_EVIDENCE_MISMATCH');
  }
  const resumedAt = new Date();
  const resumed = await tx.performanceSafetyPause.update({ where: { id: pause.id }, data: { status: 'RESUMED', resumedByUserId: input.actorUserId,
    resumedAt, resumeReason: input.reasonCode } });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_SAFETY_PAUSE', aggregateId: pause.id,
    eventType: 'PERFORMANCE_SAFETY_PAUSE_RESUMED', actorUserId: input.actorUserId, reason: input.reasonCode,
    authorityHash: canonicalPerformanceHash({ actorUserId: input.actorUserId, approvalIds: approvals.map(({ id }) => id).sort() }),
    evidence: { pauseId: pause.id, evidenceHash: input.evidenceHash, resumedAt } });
  return resumed;
});
