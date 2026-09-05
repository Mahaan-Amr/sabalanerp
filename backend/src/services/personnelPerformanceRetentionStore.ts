import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, readPerformancePayload, persistPerformancePayload } from './personnelPerformancePayloadStore';
import { evaluatePerformanceRetention, isSupportedPerformanceRetentionPolicy, PERFORMANCE_RETENTION_SCHEDULE_V1 } from './personnelPerformanceRetention';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';

export const readPerformanceRetentionPolicy = async (client: PrismaClient | Prisma.TransactionClient, at: Date) => {
  const policy = await client.performancePolicyVersion.findFirst({
    where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE', effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
  if (!policy?.encryptedPayloadId) throw Object.assign(new Error('برنامه نگهداری مصوب و قابل بازسازی وجود ندارد. پاک‌سازی تا تعیین تکلیف منابع انسانی متوقف است.'), {
    code: 'PERFORMANCE_RETENTION_POLICY_MISSING', status: 409,
  });
  const content = await readPerformancePayload<unknown>(client, policy.encryptedPayloadId, performanceVaultKeyFromEnvironment());
  if (!isSupportedPerformanceRetentionPolicy(content) || canonicalPerformanceHash(content) !== policy.contentHash) {
    throw Object.assign(new Error('نسخه برنامه نگهداری قابل تأیید نیست. پاک‌سازی تا بررسی مالک سامانه متوقف است.'), {
      code: 'PERFORMANCE_RETENTION_POLICY_UNVERIFIED', status: 409,
    });
  }
  return { policy, content: PERFORMANCE_RETENTION_SCHEDULE_V1 };
};

export const assessPerformanceEvaluationRetention = async (client: PrismaClient | Prisma.TransactionClient, input: {
  actorUserId: string; evaluationId: string;
}) => runPerformanceSerializableTransaction(client, async (tx) => {
  const permissions = await activeHrActionPermissionsForUser(tx, input.actorUserId);
  if (!permissions.includes('MANAGE_PERFORMANCE_RETENTION')) throw Object.assign(new Error('مجوز مستقل بررسی نگهداری عملکرد را ندارید.'), {
    code: 'PERFORMANCE_RETENTION_PERMISSION_REQUIRED', status: 403,
  });
  const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: input.evaluationId } });
  if (!evaluation) throw Object.assign(new Error('پرونده عملکرد پیدا نشد.'), { code: 'PERFORMANCE_EVALUATION_NOT_FOUND', status: 404 });
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const { policy, content } = await readPerformanceRetentionPolicy(tx, clock.now);
  const subject = await tx.performanceSubject.findUniqueOrThrow({ where: { id: evaluation.subjectId } });
  const relationship = subject.employmentRelationshipId
    ? await tx.hrEmploymentRelationship.findUnique({ where: { id: subject.employmentRelationshipId } }) : null;
  const sections = await tx.performanceEvaluationSection.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const sectionIds = sections.map(({ id }) => id);
  const drafts = await tx.performanceDraft.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: { id: 'asc' } });
  const submissions = await tx.performanceSubmission.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: { id: 'asc' } });
  const reviews = await tx.performanceReview.findMany({ where: { submissionId: { in: submissions.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
  const results = await tx.performanceAcceptedResult.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const traces = await tx.performanceCalculationTrace.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const snapshots = await tx.performanceSnapshot.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const corrections = await tx.performanceCorrection.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const restrictions = await tx.performanceEvidenceRestriction.findMany({ where: { evaluationId: evaluation.id }, orderBy: { id: 'asc' } });
  const scopes = await tx.performancePrivacyScope.findMany({ where: { evaluationId: evaluation.id } });
  const cases = await tx.performancePrivacyCase.findMany({ where: { id: { in: scopes.map(({ caseId }) => caseId) } }, orderBy: { id: 'asc' } });
  const bindings = await tx.performanceArtifactSnapshotBinding.findMany({ where: { snapshotId: { in: snapshots.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
  const holdScopes = [
    { aggregateType: 'EVALUATION', aggregateId: evaluation.id },
    { aggregateType: 'PERFORMANCE_SUBJECT', aggregateId: subject.id },
    ...sections.map(({ id }) => ({ aggregateType: 'EVALUATION_SECTION', aggregateId: id })),
    ...drafts.map(({ id }) => ({ aggregateType: 'PERFORMANCE_DRAFT', aggregateId: id })),
    ...submissions.map(({ id }) => ({ aggregateType: 'PERFORMANCE_SUBMISSION', aggregateId: id })),
    ...reviews.map(({ id }) => ({ aggregateType: 'PERFORMANCE_REVIEW', aggregateId: id })),
    ...results.map(({ id }) => ({ aggregateType: 'ACCEPTED_RESULT', aggregateId: id })),
    ...traces.map(({ id }) => ({ aggregateType: 'CALCULATION_TRACE', aggregateId: id })),
    ...cases.map(({ id }) => ({ aggregateType: 'PERFORMANCE_PRIVACY_CASE', aggregateId: id })),
    ...bindings.flatMap((binding) => [
      ...(binding.policyVersionId ? [{ aggregateType: 'POLICY_VERSION', aggregateId: binding.policyVersionId }] : []),
      ...(binding.criterionVersionId ? [{ aggregateType: 'CRITERION_VERSION', aggregateId: binding.criterionVersionId }] : []),
      ...(binding.templateVersionId ? [{ aggregateType: 'TEMPLATE_VERSION', aggregateId: binding.templateVersionId }] : []),
    ]),
  ];
  type Dependency = { id: string; kind: 'DISPUTE' | 'CORRECTION' | 'CONSEQUENCE' | 'PRIVACY_ACCESS' | 'PRIVACY_ERASURE'; closedAt: Date | null };
  const dependencies: Dependency[] = [
    ...restrictions.map((row) => ({ id: row.id, kind: 'DISPUTE' as const, closedAt: row.status === 'ACTIVE' ? null : row.releasedAt })),
    ...corrections.map((row) => ({ id: row.id, kind: 'CORRECTION' as const, closedAt: row.status === 'OPEN' ? null : row.decidedAt })),
    ...cases.map((row) => ({ id: row.id,
      kind: row.requestKind === 'ACCESS' ? 'PRIVACY_ACCESS' as const : row.requestKind === 'ERASURE' ? 'PRIVACY_ERASURE' as const : 'CORRECTION' as const,
      closedAt: row.status === 'CLOSED' ? row.closedAt : null })),
  ];
  const resultIds = new Set(results.map(({ id }) => id));
  const unresolvedHandoffs: string[] = [];
  const handoffs = await tx.performanceConsequenceHandoff.findMany({ where: { subjectId: subject.id }, orderBy: { id: 'asc' } });
  for (const handoff of handoffs) {
    const packageRecord = handoff.packageId ? await tx.performanceConsequencePackage.findUnique({ where: { id: handoff.packageId } }) : null;
    const payloadId = packageRecord?.encryptedPayloadId ?? handoff.encryptedPayloadId;
    if (!payloadId) { unresolvedHandoffs.push(handoff.id); continue; }
    const snapshot = await readPerformancePayload<{ selectedResults?: Array<{ id: string }>; recentTrend?: Array<{ resultId: string }>; projectionResultIds?: string[]; currentProjection?: { state: string } }>(tx, payloadId, performanceVaultKeyFromEnvironment());
    if (canonicalPerformanceHash(snapshot) !== handoff.snapshotHash) throw Object.assign(new Error('وابستگی پیامد قابل تأیید نیست.'), { code: 'PERFORMANCE_RETENTION_DEPENDENCY_UNVERIFIED', status: 409 });
    if (snapshot.currentProjection?.state === 'LEVEL' && !snapshot.projectionResultIds) unresolvedHandoffs.push(handoff.id);
    if (snapshot.selectedResults?.some(({ id }) => resultIds.has(id)) || snapshot.recentTrend?.some(({ resultId }) => resultIds.has(resultId))
      || snapshot.projectionResultIds?.some((id) => resultIds.has(id)) || unresolvedHandoffs.includes(handoff.id)) {
      dependencies.push({ id: handoff.id, kind: 'CONSEQUENCE', closedAt: handoff.closedAt });
      holdScopes.push({ aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id });
    }
  }
  const holds = await tx.performanceLegalHold.findMany({ where: { status: 'ACTIVE', OR: holdScopes }, orderBy: { id: 'asc' } });
  // Only immutable closure events can start the clock; updatedAt also changes on unrelated writes.
  const closure = ['CANCELLED', 'INVALIDATED', 'NOT_EVALUABLE'].includes(evaluation.status)
    ? await tx.performanceAuditEvent.findFirst({ where: { aggregateType: 'EVALUATION', aggregateId: evaluation.id,
      eventType: `EVALUATION_${evaluation.status}` }, orderBy: { occurredAt: 'desc' } }) : null;
  const classification = results.length ? 'ACCEPTED_EVIDENCE'
    : evaluation.status === 'NOT_EVALUABLE' || (['CANCELLED', 'INVALIDATED'].includes(evaluation.status) && submissions.length > 0) ? 'REJECTED_EVIDENCE' : 'DRAFT';
  const decision = evaluatePerformanceRetention({ policy: content, classification, now: clock.now,
    relationshipEndedAt: relationship?.status === 'ENDED' ? relationship.effectiveTo : null,
    closedAt: closure?.occurredAt, createdAt: evaluation.createdAt, dependencies,
    legalHold: holds.length > 0, requiredForReconstruction: unresolvedHandoffs.length > 0 });
  // Calendar eligibility alone cannot authorize destruction of copies or shared reconstruction evidence.
  const status = decision.state === 'ELIGIBLE' ? 'PENDING_COPY_AND_RECONSTRUCTION_REVIEW' : decision.state;
  const basis = { schemaVersion: 1, evaluationId: evaluation.id, writerVersion: evaluation.writerVersion,
    evaluationStatus: evaluation.status, classification, status, deleteAfter: decision.deleteAfter,
    policyVersionId: policy.id, policyContentHash: policy.contentHash,
    relationshipId: relationship?.id ?? null, relationshipEndedAt: relationship?.status === 'ENDED' ? relationship.effectiveTo : null,
    closureEventId: closure?.id ?? null, closureEventHash: closure?.eventHash ?? null, dependencies,
    legalHoldIds: holds.map(({ id }) => id), unresolvedHandoffs,
    evidenceIds: [...sections, ...drafts, ...submissions, ...reviews, ...results, ...traces, ...snapshots, ...bindings].map(({ id }) => id).sort(),
  };
  const basisHash = canonicalPerformanceHash(basis);
  const previous = await tx.performanceRetentionState.findFirst({ where: { aggregateType: 'EVALUATION', aggregateId: evaluation.id }, orderBy: { version: 'desc' } });
  if (previous) {
    const audit = await tx.performanceAuditEvent.findFirst({ where: { aggregateType: 'PERFORMANCE_RETENTION_STATE', aggregateId: previous.id, eventType: 'RETENTION_ASSESSED' } });
    if (audit?.encryptedPayloadId) {
      const oldBasis = await readPerformancePayload<unknown>(tx, audit.encryptedPayloadId, performanceVaultKeyFromEnvironment());
      if (canonicalPerformanceHash(oldBasis) === basisHash) return previous;
    }
  }
  const state = await tx.performanceRetentionState.create({ data: { aggregateType: 'EVALUATION', aggregateId: evaluation.id,
    classification, status, deleteAfter: decision.deleteAfter, legalHoldCount: holds.length, policyVersionId: policy.id, version: (previous?.version ?? 0) + 1 } });
  const payload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_RETENTION_STATE', aggregateId: state.id,
    payloadKind: 'ASSESSMENT_BASIS', schemaVersion: 1, payload: basis, keyring: performanceVaultKeyFromEnvironment() });
  const id = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'PERFORMANCE_RETENTION_STATE', aggregateId: state.id,
    eventType: 'RETENTION_ASSESSED', actorUserId: input.actorUserId, encryptedPayloadId: payload.id,
    authorityHash: canonicalPerformanceHash({ permission: 'MANAGE_PERFORMANCE_RETENTION', actorUserId: input.actorUserId }),
    eventHash: canonicalPerformanceHash({ id, stateId: state.id, basisHash }) } });
  return state;
});
