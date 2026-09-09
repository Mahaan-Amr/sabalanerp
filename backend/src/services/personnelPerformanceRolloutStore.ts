import { randomUUID } from 'node:crypto';
import type { PerformanceRolloutPhase, Prisma, PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment, readPerformancePayload } from './personnelPerformancePayloadStore';
import {
  performancePromotionAttestationKeyFromEnvironment,
  performanceRuntimeReleaseIdentityFromEnvironment,
  verifyPerformancePromotionEvidence,
  type PerformanceCohortStage,
  type PerformancePromotionEvidenceReport,
} from './personnelPerformancePromotionEvidence';
import { assertPerformanceOperationalExpansionReady } from './personnelPerformanceMonitoringStore';

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
const phases: PerformanceRolloutPhase[] = ['SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT',
  'RESULT_LEVEL_BADGE', 'ANALYTICS_RANKING_CALIBRATION', 'PDF_EXCEL_EXPORT', 'CONSEQUENCE_HANDOFF', 'EXPANSION_RETIREMENT'];
const stages: Stage[] = ['PILOT', 'TEN_PERCENT', 'TWENTY_FIVE_PERCENT', 'FIFTY_PERCENT', 'ALL'];
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

const currentPerformanceReleaseIdentity = async (tx: Prisma.TransactionClient) => {
  const configured = performanceRuntimeReleaseIdentityFromEnvironment();
  const [row] = await tx.$queryRaw<Array<{ metadata: { migrations: unknown; policies: unknown } }>>`
    SELECT json_build_object(
      'migrations', (SELECT json_agg(row_to_json(m) ORDER BY m.migration_name) FROM
        (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished,
          rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations) m),
      'policies', (SELECT json_agg(row_to_json(p) ORDER BY p."policyKind", p.version) FROM
        (SELECT "policyKind", version, lifecycle, "effectiveFrom", "contentHash" FROM performance_policy_versions) p)
    ) AS metadata`;
  const schemaHash = canonicalPerformanceHash(row.metadata.migrations);
  const policyHash = canonicalPerformanceHash(row.metadata.policies);
  if (configured.schemaHash !== schemaHash) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_SCHEMA_CHANGED');
  if (configured.policyHash !== policyHash) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_POLICY_CHANGED');
  return configured;
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
  actorUserId: string; cohortKey: string; stage: Stage; targetPhase: PerformanceRolloutPhase;
  subjectIds: string[]; readinessHash: string; reason: string; now?: Date;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const authorityHash = await requirePermission(tx, input.actorUserId, 'MANAGE_PERFORMANCE_ROLLOUT');
  const subjectIds = [...new Set(input.subjectIds)].sort();
  const now = input.now ?? new Date();
  if (!input.cohortKey.trim() || !subjectIds.length || subjectIds.length > 10_000 || !validHash(input.readinessHash)
    || input.reason.trim().length < 8 || input.reason.length > 2_000 || !Object.prototype.hasOwnProperty.call(stagePercent, input.stage)
    || !phases.includes(input.targetPhase)) {
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
  const latestPhase = await tx.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: now } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  const expectedStageIndex = previous?.stage ? stages.indexOf(previous.stage as Stage) + 1 : 0;
  const currentPhaseIndex = latestPhase ? phases.indexOf(latestPhase.phase) : -1;
  const targetPhaseIndex = phases.indexOf(input.targetPhase);
  if (stages.indexOf(input.stage) !== expectedStageIndex || (previous && previous.lifecycle !== 'ACTIVE')
    || targetPhaseIndex < currentPhaseIndex || targetPhaseIndex > currentPhaseIndex + 1) {
    throw rolloutError('PERFORMANCE_COHORT_STAGE_OUT_OF_ORDER');
  }
  const cohort = await tx.performanceCohortVersion.create({ data: { cohortKey: input.cohortKey, version: (previous?.version ?? 0) + 1,
    predecessorId: previous?.id, membershipHash: canonicalPerformanceHash(subjectIds), stage: input.stage,
    targetPercent: stagePercent[input.stage], readinessHash: input.readinessHash, targetPhase: input.targetPhase,
    activationReason: input.reason.trim(), createdByUserId: input.actorUserId } });
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
  action: 'APPROVE' | 'VETO' | 'APPROVE_RESUME'; reasonCode: string; evidenceHash?: string; promotionEvidenceId?: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const expectedAction = input.scopeType === 'COHORT' ? ['APPROVE', 'VETO'] : ['APPROVE_RESUME'];
  if (!validOwnerType(input.ownerType) || !expectedAction.includes(input.action) || !validReason(input.reasonCode)) {
    throw rolloutError('PERFORMANCE_ROLLOUT_DECISION_INVALID', 422);
  }
  const permission = input.scopeType === 'COHORT' ? ownerPermission[input.ownerType].cohort : ownerPermission[input.ownerType].resume;
  const authorityHash = await requirePermission(tx, input.actorUserId, permission);
  let evidenceHash = input.evidenceHash;
  if (input.scopeType === 'COHORT') {
    await tx.$queryRaw`SELECT id FROM performance_cohort_versions WHERE id = ${input.scopeId} FOR UPDATE`;
    const cohort = await tx.performanceCohortVersion.findUnique({ where: { id: input.scopeId } });
    if (!cohort) throw rolloutError('PERFORMANCE_ROLLOUT_SCOPE_UNAVAILABLE', 404);
    if (input.action === 'APPROVE') {
      if (!input.promotionEvidenceId) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_REQUIRED', 422);
      evidenceHash = (await assertPerformancePromotionEvidence(tx, input.promotionEvidenceId, cohort)).evidenceHash;
    } else if (!evidenceHash || !validHash(evidenceHash)) throw rolloutError('PERFORMANCE_ROLLOUT_DECISION_INVALID', 422);
  } else {
    if (!await tx.performanceSafetyPause.findUnique({ where: { id: input.scopeId } })) {
      throw rolloutError('PERFORMANCE_ROLLOUT_SCOPE_UNAVAILABLE', 404);
    }
    if (!evidenceHash || !validHash(evidenceHash)) throw rolloutError('PERFORMANCE_ROLLOUT_DECISION_INVALID', 422);
  }
  const previous = await tx.performanceRolloutDecision.findFirst({ where: { scopeType: input.scopeType, scopeId: input.scopeId,
    ownerType: input.ownerType }, orderBy: { version: 'desc' } });
  return tx.performanceRolloutDecision.create({ data: { actorUserId: input.actorUserId, scopeType: input.scopeType, scopeId: input.scopeId,
    ownerType: input.ownerType, action: input.action, reasonCode: input.reasonCode, evidenceHash: evidenceHash!,
    promotionEvidenceId: input.scopeType === 'COHORT' && input.action === 'APPROVE' ? input.promotionEvidenceId : null,
    version: (previous?.version ?? 0) + 1, authorityHash } });
});

const currentApprovals = async (tx: Prisma.TransactionClient, scopeType: 'COHORT' | 'SAFETY_PAUSE', scopeId: string) => {
  const decisions = await tx.performanceRolloutDecision.findMany({ where: { scopeType, scopeId }, orderBy: [{ ownerType: 'asc' }, { version: 'desc' }] });
  const latestByOwner = new Map<string, typeof decisions[number]>();
  for (const row of decisions) if (!latestByOwner.has(row.ownerType)) latestByOwner.set(row.ownerType, row);
  const latest = [...latestByOwner.values()];
  const action = scopeType === 'COHORT' ? 'APPROVE' : 'APPROVE_RESUME';
  if (latest.length !== 3 || latest.some((row) => row.action !== action) || new Set(latest.map(({ actorUserId }) => actorUserId)).size !== 3
    || (scopeType === 'COHORT' && (latest.some(({ promotionEvidenceId }) => !promotionEvidenceId)
      || new Set(latest.map(({ promotionEvidenceId }) => promotionEvidenceId)).size !== 1))) {
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
  const populationSubjects = await tx.performanceSubject.findMany({ where: { identityDetachedAt: null, employmentRelationshipId: { not: null } },
    select: { id: true, employmentRelationshipId: true } });
  const populationRelationships = await tx.hrEmploymentRelationship.findMany({ where: {
    id: { in: populationSubjects.map(({ employmentRelationshipId }) => employmentRelationshipId!) }, status: { in: ['ACTIVE', 'SUSPENDED'] },
    effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  }, select: { id: true } });
  const relationshipIds = new Set(populationRelationships.map(({ id }) => id));
  const candidates = populationSubjects.filter(({ employmentRelationshipId }) => relationshipIds.has(employmentRelationshipId!));
  const populationTraining = await tx.performanceTrainingEvidence.findMany({ where: { subjectId: { in: candidates.map(({ id }) => id) },
    completedAt: { lte: now }, validUntil: { gt: now } }, select: { subjectId: true } });
  const trained = new Set(populationTraining.map(({ subjectId }) => subjectId));
  const populationEvaluations = await tx.performanceEvaluation.findMany({ where: { subjectId: { in: candidates.map(({ id }) => id) },
  }, select: { id: true, subjectId: true } });
  const populationReadiness = await tx.performanceReadinessRecord.findMany({ where: { evaluationId: { in: populationEvaluations.map(({ id }) => id) },
    status: 'APPLIED' }, select: { evaluationId: true, runId: true } });
  const populationRuns = await tx.performanceReadinessRun.findMany({ where: { id: { in: populationReadiness.map(({ runId }) => runId) },
    status: 'COMPLETED', driftDetected: false }, select: { id: true } });
  const populationRunIds = new Set(populationRuns.map(({ id }) => id));
  const readyEvaluationIds = new Set(populationReadiness.filter(({ runId }) => populationRunIds.has(runId)).map(({ evaluationId }) => evaluationId));
  const readyPopulation = new Set(populationEvaluations.filter(({ id, subjectId }) => readyEvaluationIds.has(id) && trained.has(subjectId))
    .map(({ subjectId }) => subjectId)).size;
  return { memberCount: subjectIds.length, readyPopulation };
};

type PromotionCohort = {
  id: string;
  stage: string | null;
  targetPhase: PerformanceRolloutPhase | null;
  membershipHash: string;
  readinessHash: string | null;
};

const assertPerformancePromotionEvidence = async (
  tx: Prisma.TransactionClient,
  promotionEvidenceId: string,
  cohort: PromotionCohort,
  now?: Date,
  population?: { readyPopulation: number; memberCount: number },
) => {
  if (!cohort.stage || !cohort.targetPhase || !stages.includes(cohort.stage as Stage)) {
    throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_UNRELATED');
  }
  const [clock] = now ? [{ now }] : await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const currentPopulation = population ?? await assertCohortEligibility(tx, cohort, clock.now);
  const evidence = await tx.performancePromotionEvidence.findUnique({ where: { id: promotionEvidenceId } });
  if (!evidence) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_UNAVAILABLE');
  if (await tx.performancePromotionEvidenceRevocation.findFirst({ where: { promotionEvidenceId } })) {
    throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_REVOKED');
  }
  const report = await readPerformancePayload<PerformancePromotionEvidenceReport>(tx, evidence.encryptedPayloadId, performanceVaultKeyFromEnvironment());
  const verified = verifyPerformancePromotionEvidence(report, {
    now: clock.now,
    release: await currentPerformanceReleaseIdentity(tx),
    phase: cohort.targetPhase,
    cohortVersionId: cohort.id,
    cohortStage: cohort.stage as PerformanceCohortStage,
    membershipHash: cohort.membershipHash,
    readyPopulation: currentPopulation.readyPopulation,
    memberCount: currentPopulation.memberCount,
    ...performancePromotionAttestationKeyFromEnvironment(),
  });
  if (verified.evidenceHash !== evidence.evidenceHash || evidence.targetCohortVersionId !== cohort.id
    || evidence.targetCohortStage !== cohort.stage || evidence.targetMembershipHash !== cohort.membershipHash
    || evidence.targetPhase !== cohort.targetPhase || evidence.targetReadyPopulation !== currentPopulation.readyPopulation
    || evidence.targetMemberCount !== currentPopulation.memberCount || evidence.validUntil <= clock.now) {
    throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_TAMPERED');
  }
  // The database transition trigger accepts a cohort state change only after
  // this transaction has decrypted and authenticated this exact evidence.
  await tx.$executeRaw`SELECT set_config('sabalan.performance_promotion_evidence_hash', ${verified.evidenceHash}, true)`;
  return { ...evidence, evidenceHash: verified.evidenceHash };
};

export const recordPerformancePromotionEvidence = async (client: Client, input: {
  actorUserId: string;
  report: PerformancePromotionEvidenceReport;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const authorityHash = await requirePermission(tx, input.actorUserId, 'RECORD_PERFORMANCE_PROMOTION_EVIDENCE');
  const targetCohortVersionId = input.report?.target?.cohortVersionId;
  if (typeof targetCohortVersionId !== 'string' || !targetCohortVersionId) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_UNRELATED', 422);
  await tx.$queryRaw`SELECT id FROM performance_cohort_versions WHERE id = ${targetCohortVersionId} FOR UPDATE`;
  const cohort = await tx.performanceCohortVersion.findUnique({ where: { id: targetCohortVersionId } });
  if (!cohort || !['DRAFT', 'SCHEDULED'].includes(cohort.lifecycle)) throw rolloutError('PERFORMANCE_ROLLOUT_SCOPE_UNAVAILABLE', 404);
  if (!cohort.stage || !cohort.targetPhase) throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_UNRELATED', 422);
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const population = await assertCohortEligibility(tx, cohort, clock.now);
  const verified = verifyPerformancePromotionEvidence(input.report, {
    now: clock.now,
    release: await currentPerformanceReleaseIdentity(tx),
    phase: cohort.targetPhase,
    cohortVersionId: cohort.id,
    cohortStage: cohort.stage as PerformanceCohortStage,
    membershipHash: cohort.membershipHash,
    readyPopulation: population.readyPopulation,
    memberCount: population.memberCount,
    ...performancePromotionAttestationKeyFromEnvironment(),
  });
  const existing = await tx.performancePromotionEvidence.findUnique({ where: { evidenceHash: verified.evidenceHash } });
  if (existing) return existing;
  const id = randomUUID();
  const payload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_PROMOTION_EVIDENCE', aggregateId: id,
    payloadKind: 'AUTHENTICATED_REPORT', schemaVersion: 1, payload: input.report, keyring: performanceVaultKeyFromEnvironment() });
  const evidence = await tx.performancePromotionEvidence.create({ data: {
    id, evidenceHash: verified.evidenceHash, manifestHash: input.report.manifestHash,
    releaseCommit: input.report.release.commit, releaseSourceHash: input.report.release.sourceHash,
    releaseSchemaHash: input.report.release.schemaHash, releasePolicyHash: input.report.release.policyHash,
    releaseInfrastructureHash: input.report.release.infrastructureHash,
    backendImageDigest: input.report.release.images.backend, frontendImageDigest: input.report.release.images.frontend,
    inquiryImageDigest: input.report.release.images.inquiry, targetPhase: input.report.target.phase,
    targetCohortVersionId: input.report.target.cohortVersionId, targetCohortStage: input.report.target.cohortStage,
    targetMembershipHash: input.report.target.membershipHash, targetReadyPopulation: input.report.target.readyPopulation,
    targetMemberCount: input.report.target.memberCount, targetGate: verified.targetGate, encryptedPayloadId: payload.id,
    attestationKeyId: input.report.attestation.keyId, authenticatedByUserId: input.actorUserId,
    verifiedAt: new Date(input.report.verifiedAt), validUntil: new Date(input.report.validUntil),
  } });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_PROMOTION_EVIDENCE', aggregateId: id,
    eventType: 'PERFORMANCE_PROMOTION_EVIDENCE_AUTHENTICATED', actorUserId: input.actorUserId,
    reason: 'AUTHENTICATED_RELEASE_BOUND_EVIDENCE', authorityHash,
    evidence: { evidenceHash: evidence.evidenceHash, manifestHash: evidence.manifestHash, targetCohortVersionId: cohort.id,
      targetPhase: evidence.targetPhase, validUntil: evidence.validUntil } });
  return evidence;
});

export const revokePerformancePromotionEvidence = async (client: Client, input: {
  actorUserId: string; promotionEvidenceId: string; reasonCode: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const authorityHash = await requirePermission(tx, input.actorUserId, 'RECORD_PERFORMANCE_PROMOTION_EVIDENCE');
  if (!validReason(input.reasonCode)) throw rolloutError('PERFORMANCE_PROMOTION_REVOCATION_INVALID', 422);
  if (!await tx.performancePromotionEvidence.findUnique({ where: { id: input.promotionEvidenceId } })) {
    throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_UNAVAILABLE', 404);
  }
  const revocation = await tx.performancePromotionEvidenceRevocation.create({ data: { id: randomUUID(),
    promotionEvidenceId: input.promotionEvidenceId, reasonCode: input.reasonCode, revokedByUserId: input.actorUserId } });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_PROMOTION_EVIDENCE', aggregateId: input.promotionEvidenceId,
    eventType: 'PERFORMANCE_PROMOTION_EVIDENCE_REVOKED', actorUserId: input.actorUserId, reason: input.reasonCode,
    authorityHash, evidence: { revocationId: revocation.id, promotionEvidenceId: input.promotionEvidenceId } });
  return revocation;
});

export const activatePerformanceCohort = async (client: Client, input: {
  actorUserId: string; cohortVersionId: string; effectiveFrom: Date; reason: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  await requirePermission(tx, input.actorUserId, 'TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT');
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  await tx.$queryRaw`SELECT id FROM performance_cohort_versions WHERE id = ${input.cohortVersionId} FOR UPDATE`;
  const cohort = await tx.performanceCohortVersion.findUnique({ where: { id: input.cohortVersionId } });
  if (!cohort || cohort.lifecycle !== 'DRAFT' || !cohort.stage || !validDate(input.effectiveFrom)
    || input.effectiveFrom < clock.now || input.reason.trim().length < 8) throw rolloutError('PERFORMANCE_COHORT_ACTIVATION_INVALID', 422);
  const approvals = await currentApprovals(tx, 'COHORT', cohort.id);
  const populationNow = await assertCohortEligibility(tx, cohort, clock.now);
  const populationAtActivation = await assertCohortEligibility(tx, cohort, input.effectiveFrom);
  const promotionEvidenceId = approvals[0].promotionEvidenceId!;
  await assertPerformancePromotionEvidence(tx, promotionEvidenceId, cohort, input.effectiveFrom, populationNow);
  await assertPerformanceOperationalExpansionReady(tx, clock.now);
  if (populationAtActivation.readyPopulation !== populationNow.readyPopulation || populationAtActivation.memberCount !== populationNow.memberCount) {
    throw rolloutError('PERFORMANCE_PROMOTION_EVIDENCE_POPULATION_CHANGED');
  }
  const scheduled = await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'SCHEDULED', effectiveFrom: input.effectiveFrom,
    activationReason: input.reason.trim(), activatedByUserId: input.actorUserId, promotionEvidenceId } });
  await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_COHORT_VERSION', aggregateId: cohort.id,
    eventType: 'PERFORMANCE_COHORT_SCHEDULED', actorUserId: input.actorUserId, reason: input.reason.trim(),
    authorityHash: canonicalPerformanceHash({ actorUserId: input.actorUserId, approvalIds: approvals.map(({ id }) => id).sort() }),
    evidence: { cohortId: cohort.id, effectiveFrom: input.effectiveFrom, approvalIds: approvals.map(({ id }) => id).sort() } });
  return scheduled;
});

export const activateDuePerformanceCohorts = async (client: Client) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
  const [selectionClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const due = await tx.performanceCohortVersion.findMany({ where: { lifecycle: 'SCHEDULED', effectiveFrom: { lte: selectionClock.now }, stage: { not: null } },
    orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
  const activated: Array<typeof due[number]> = [];
  for (const cohort of due) {
    await tx.$queryRaw`SELECT id FROM performance_cohort_versions WHERE id = ${cohort.id} FOR UPDATE`;
    const [activationClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const approvals = await currentApprovals(tx, 'COHORT', cohort.id);
    const population = await assertCohortEligibility(tx, cohort, activationClock.now);
    const promotionEvidenceId = approvals[0].promotionEvidenceId!;
    await assertPerformancePromotionEvidence(tx, promotionEvidenceId, cohort, activationClock.now, population);
    await assertPerformanceOperationalExpansionReady(tx, activationClock.now);
    await tx.performanceCohortVersion.updateMany({ where: { cohortKey: cohort.cohortKey, lifecycle: 'ACTIVE', id: { not: cohort.id } },
      data: { lifecycle: 'RETIRED' } });
    const active = await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'ACTIVE', promotionEvidenceId } });
    const latestPhase = await tx.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
    await tx.performanceFeaturePhaseVersion.create({ data: { version: (latestPhase?.version ?? 0) + 1, predecessorId: latestPhase?.id,
      phase: cohort.targetPhase!, releaseEnabled: true, cohortVersionId: cohort.id, promotionEvidenceId,
      effectiveFrom: cohort.effectiveFrom!, recordedByUserId: cohort.activatedByUserId!,
      reason: `${cohort.activationReason} | ${canonicalPerformanceHash(approvals.map(({ id }) => id).sort())}` } });
    await appendRolloutAudit(tx, { aggregateType: 'PERFORMANCE_COHORT_VERSION', aggregateId: cohort.id,
      eventType: 'PERFORMANCE_COHORT_ACTIVATED', actorUserId: null, reason: 'SCHEDULED_ACTIVATION',
      authorityHash: canonicalPerformanceHash({ system: 'PERSONNEL_PERFORMANCE_MAINTENANCE', approvalIds: approvals.map(({ id }) => id).sort() }),
      evidence: { cohortId: cohort.id, effectiveFrom: cohort.effectiveFrom, activatedAt: activationClock.now } });
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
