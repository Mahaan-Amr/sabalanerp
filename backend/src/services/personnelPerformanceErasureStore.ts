import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload, readPerformancePayload } from './personnelPerformancePayloadStore';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { assessPerformanceEvaluationRetention } from './personnelPerformanceRetentionStore';
import { resolvePerformanceExportDependencies } from './personnelPerformanceExportLineage';
import { erasePerformanceExportArtifacts } from './personnelPerformanceDisclosureStore';
import {
  classifyPerformanceErasureRecords,
  decidePerformanceErasureProgress,
  performanceErasureOperationIdentity,
  requiredPerformanceCopyLocations,
  type PerformanceCopyLocation,
  type PerformanceCopyStatus,
} from './personnelPerformanceErasure';

type Client = PrismaClient | Prisma.TransactionClient;
const SYSTEM_ABSENCE_EVIDENCE = canonicalPerformanceHash({ schemaVersion: 1, architecture: 'NO_PERFORMANCE_COPY_ADAPTER', version: 1 });
const retryDelayMs = 15 * 60 * 1000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const erasureError = (message: string, code: string, status = 409) => Object.assign(new Error(message), { code, status });
const requireRetentionPermission = async (client: Client, actorUserId: string) => {
  const permissions = await activeHrActionPermissionsForUser(client, actorUserId);
  if (!permissions.includes('MANAGE_PERFORMANCE_RETENTION')) throw erasureError('مجوز مستقل مدیریت حذف شواهد عملکرد را ندارید.', 'PERFORMANCE_RETENTION_PERMISSION_REQUIRED', 403);
  return canonicalPerformanceHash({ permission: 'MANAGE_PERFORMANCE_RETENTION', actorUserId });
};

const discoverGraph = async (tx: Client, evaluationId: string) => {
  const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation) throw erasureError('پرونده عملکرد برای حذف پیدا نشد.', 'PERFORMANCE_ERASURE_SCOPE_MISSING');
  const subject = await tx.performanceSubject.findUniqueOrThrow({ where: { id: evaluation.subjectId } });
  const sections = await tx.performanceEvaluationSection.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } });
  const sectionIds = sections.map(({ id }) => id);
  const [drafts, submissions, results, traces, snapshots, corrections, privacyScopes] = await Promise.all([
    tx.performanceDraft.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: { id: 'asc' } }),
    tx.performanceSubmission.findMany({ where: { sectionId: { in: sectionIds } }, orderBy: { id: 'asc' } }),
    tx.performanceAcceptedResult.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } }),
    tx.performanceCalculationTrace.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } }),
    tx.performanceSnapshot.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } }),
    tx.performanceCorrection.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } }),
    tx.performancePrivacyScope.findMany({ where: { evaluationId }, orderBy: { id: 'asc' } }),
  ]);
  const reviews = await tx.performanceReview.findMany({ where: { submissionId: { in: submissions.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
  const bindings = await tx.performanceArtifactSnapshotBinding.findMany({ where: { snapshotId: { in: snapshots.map(({ id }) => id) } } });
  const handoffs = await tx.performanceConsequenceHandoff.findMany({ where: { subjectId: subject.id }, orderBy: { id: 'asc' } });
  const exportDependencies = await tx.performanceExportDependency.findMany({ where: {
    aggregateType: 'EVALUATION', aggregateIdHash: sha256(evaluationId),
  } });
  const exportIds = [...new Set(exportDependencies.map(({ exportId }) => exportId))].sort();
  const verifiedExportDependencies: Array<{ aggregateType: string; aggregateIdHash: string }> = [];
  for (const exportId of exportIds) verifiedExportDependencies.push(...await resolvePerformanceExportDependencies(tx as Prisma.TransactionClient, exportId));
  const auditScopes = [
    { aggregateType: 'EVALUATION', aggregateId: evaluationId },
    ...sectionIds.map((aggregateId) => ({ aggregateType: 'EVALUATION_SECTION', aggregateId })),
    ...drafts.map(({ id: aggregateId }) => ({ aggregateType: 'PERFORMANCE_DRAFT', aggregateId })),
    ...submissions.map(({ id: aggregateId }) => ({ aggregateType: 'PERFORMANCE_SUBMISSION', aggregateId })),
    ...reviews.map(({ id: aggregateId }) => ({ aggregateType: 'PERFORMANCE_REVIEW', aggregateId })),
    ...results.map(({ id: aggregateId }) => ({ aggregateType: 'ACCEPTED_RESULT', aggregateId })),
    ...traces.map(({ id: aggregateId }) => ({ aggregateType: 'CALCULATION_TRACE', aggregateId })),
    ...corrections.map(({ id: aggregateId }) => ({ aggregateType: 'PERFORMANCE_CORRECTION', aggregateId })),
  ];
  const audits = await tx.performanceAuditEvent.findMany({ where: { OR: auditScopes }, orderBy: { id: 'asc' } });
  const graph = {
    evaluationId, subjectId: subject.id, sectionIds,
    draftIds: drafts.map(({ id }) => id), submissionIds: submissions.map(({ id }) => id), reviewIds: reviews.map(({ id }) => id),
    resultIds: results.map(({ id }) => id), traceIds: traces.map(({ id }) => id), snapshotIds: snapshots.map(({ id }) => id),
    correctionIds: corrections.map(({ id }) => id), privacyCaseIds: privacyScopes.map(({ caseId }) => caseId), exportIds,
    consequenceHandoffIds: handoffs.map(({ id }) => id),
    policyVersionIds: [...new Set(bindings.flatMap(({ policyVersionId }) => policyVersionId ? [policyVersionId] : []))].sort(),
    criterionVersionIds: [...new Set(bindings.flatMap(({ criterionVersionId }) => criterionVersionId ? [criterionVersionId] : []))].sort(),
    templateVersionIds: [...new Set(bindings.flatMap(({ templateVersionId }) => templateVersionId ? [templateVersionId] : []))].sort(),
    auditEventIds: audits.map(({ id }) => id),
  };
  const classifiedRecords = classifyPerformanceErasureRecords(graph);
  return { graph, classifiedRecords, verifiedExportDependencies, payloadIds: [...new Set([
    ...drafts.map(({ encryptedPayloadId }) => encryptedPayloadId), ...submissions.map(({ encryptedPayloadId }) => encryptedPayloadId),
    ...reviews.flatMap(({ encryptedPayloadId }) => encryptedPayloadId ? [encryptedPayloadId] : []),
    ...results.map(({ encryptedPayloadId }) => encryptedPayloadId), ...traces.map(({ encryptedPayloadId }) => encryptedPayloadId),
    ...snapshots.map(({ encryptedPayloadId }) => encryptedPayloadId), ...corrections.flatMap(({ encryptedPayloadId }) => encryptedPayloadId ? [encryptedPayloadId] : []),
    ...audits.flatMap(({ encryptedPayloadId }) => encryptedPayloadId ? [encryptedPayloadId] : []),
  ])].sort() };
};

type ErasureScope = Awaited<ReturnType<typeof discoverGraph>> & { schemaVersion: 1 };
const activePerformanceErasureHold = async (tx: Client, operation: { encryptedScopeId: string }) => {
  const scope = await readPerformancePayload<ErasureScope>(tx, operation.encryptedScopeId, performanceVaultKeyFromEnvironment());
  const holdScopes = [
    { aggregateType: 'EVALUATION', aggregateId: scope.graph.evaluationId },
    { aggregateType: 'PERFORMANCE_SUBJECT', aggregateId: scope.graph.subjectId },
    ...scope.graph.sectionIds.map((aggregateId) => ({ aggregateType: 'EVALUATION_SECTION', aggregateId })),
    ...scope.graph.privacyCaseIds.map((aggregateId) => ({ aggregateType: 'PERFORMANCE_PRIVACY_CASE', aggregateId })),
    ...scope.graph.consequenceHandoffIds.map((aggregateId) => ({ aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId })),
    ...scope.graph.exportIds.map((aggregateId) => ({ aggregateType: 'PERFORMANCE_EXPORT', aggregateId })),
    ...scope.graph.policyVersionIds.map((aggregateId) => ({ aggregateType: 'POLICY_VERSION', aggregateId })),
    ...scope.graph.criterionVersionIds.map((aggregateId) => ({ aggregateType: 'CRITERION_VERSION', aggregateId })),
    ...scope.graph.templateVersionIds.map((aggregateId) => ({ aggregateType: 'TEMPLATE_VERSION', aggregateId })),
  ];
  return tx.performanceLegalHold.findFirst({ where: { status: 'ACTIVE', OR: holdScopes }, select: { id: true } });
};

const refreshOperationStatus = async (tx: Client, operationId: string, now = new Date()) => {
  const operation = await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operationId } });
  const activeHold = operation.liveErasedAt ? await activePerformanceErasureHold(tx, operation) : null;
  const expired = activeHold ? [] : await tx.performanceRecoverableCopy.findMany({ where: { operationId, location: 'INDEPENDENT_BACKUP',
    status: 'RECOVERABLE', recoverableUntil: { lte: now } }, orderBy: { version: 'desc' } });
  if (expired[0]) {
    const latestBackup = await tx.performanceRecoverableCopy.findFirst({ where: { operationId, location: 'INDEPENDENT_BACKUP' }, orderBy: { version: 'desc' } });
    if (latestBackup?.id === expired[0].id) await tx.performanceRecoverableCopy.create({ data: { operationId, location: 'INDEPENDENT_BACKUP',
      copyKeyHash: sha256(`expired:${expired[0].id}`), status: 'ERASED', version: latestBackup.version + 1, checkedAt: now,
      evidenceHash: canonicalPerformanceHash({ operationId, sourceCopyId: expired[0].id, recoverableUntil: expired[0].recoverableUntil?.toISOString(),
        source: 'INDEPENDENT_BACKUP_RETENTION_EXPIRY' }) } });
  }
  const [impact, approvals, rows] = await Promise.all([
    tx.performanceErasureImpactApproval.findUnique({ where: { policyVersionId: operation.policyVersionId } }),
    tx.performanceErasureApproval.findMany({ where: { operationId }, select: { actorUserId: true } }),
    tx.performanceRecoverableCopy.findMany({ where: { operationId }, orderBy: [{ version: 'desc' }, { id: 'desc' }] }),
  ]);
  const latest = new Map<PerformanceCopyLocation, PerformanceCopyStatus>();
  for (const row of rows) if (!latest.has(row.location as PerformanceCopyLocation)) latest.set(row.location as PerformanceCopyLocation, row.status as PerformanceCopyStatus);
  const copies = requiredPerformanceCopyLocations.map((location) => ({ location, status: latest.get(location) ?? 'UNKNOWN' as const }));
  const decidedStatus = decidePerformanceErasureProgress({ impactApproved: Boolean(impact?.approvedAt), recordCount: operation.recordCount,
    bulkThreshold: operation.bulkThreshold, distinctBulkApproverIds: approvals.map(({ actorUserId }) => actorUserId), copies,
    liveErased: Boolean(operation.liveErasedAt), partialFailure: operation.status === 'PARTIAL_RESTRICTED' });
  const status = activeHold && operation.liveErasedAt ? 'LIVE_ERASED_BACKUP_PENDING' : decidedStatus;
  return tx.performanceErasureOperation.update({ where: { id: operationId }, data: { status,
    completedAt: status === 'COMPLETED' ? now : null } });
};

const approvedBulkThreshold = () => {
  const value = Number(process.env.PERFORMANCE_ERASURE_BULK_THRESHOLD);
  if (!Number.isInteger(value) || value < 1) throw erasureError('آستانه مصوب حذف دسته‌ای پیکربندی نشده است.', 'PERFORMANCE_ERASURE_BULK_THRESHOLD_REQUIRED');
  return value;
};

export const preparePerformanceErasureOperations = async (client: Client, now = new Date(), configuredBulkThreshold?: number) => {
  const bulkThreshold = configuredBulkThreshold ?? approvedBulkThreshold();
  const evaluations = await client.performanceEvaluation.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  for (const evaluation of evaluations) await assessPerformanceEvaluationRetention(client, { actorUserId: null, evaluationId: evaluation.id });
  return runPerformanceSerializableTransaction(client, async (tx) => {
    const candidates = await tx.performanceRetentionState.findMany({ where: {
      status: 'PENDING_COPY_AND_RECONSTRUCTION_REVIEW', deleteAfter: { lte: now },
    }, orderBy: [{ aggregateType: 'asc' }, { aggregateId: 'asc' }, { version: 'desc' }] });
    const newestByAggregate = new Map<string, typeof candidates[number]>();
    for (const row of candidates) {
      const key = `${row.aggregateType}:${row.aggregateId}`;
      if (!newestByAggregate.has(key)) newestByAggregate.set(key, row);
    }
    const newest = [...newestByAggregate.values()];
    const discovered: Array<Awaited<ReturnType<typeof refreshOperationStatus>>> = [];
    const pending: Array<{
      state: typeof newest[number];
      scope: Awaited<ReturnType<typeof discoverGraph>>;
      erasableRecordCount: number;
      scopeHash: string;
    }> = [];
    for (const state of newest) {
      const existing = await tx.performanceErasureOperation.findUnique({ where: { retentionStateId: state.id } });
      if (existing) { discovered.push(await refreshOperationStatus(tx, existing.id, now)); continue; }
      if (state.aggregateType !== 'EVALUATION') continue;
      const scope = await discoverGraph(tx, state.aggregateId);
      const erasableRecordCount = scope.classifiedRecords.filter(({ erasableContent }) => erasableContent).length + scope.payloadIds.length;
      if (erasableRecordCount === 0) continue;
      const scopeHash = canonicalPerformanceHash({ graph: scope.graph, classifiedRecords: scope.classifiedRecords, payloadIds: scope.payloadIds });
      pending.push({ state, scope, erasableRecordCount, scopeHash });
    }
    const impactByPolicy = new Map<string, Awaited<ReturnType<typeof tx.performanceErasureImpactApproval.findUniqueOrThrow>>>();
    for (const policyVersionId of [...new Set(pending.map(({ state }) => state.policyVersionId))].sort()) {
      const population = pending.filter(({ state }) => state.policyVersionId === policyVersionId);
      const impact = await tx.performanceErasureImpactApproval.upsert({ where: { policyVersionId }, update: {}, create: {
        policyVersionId,
        populationHash: canonicalPerformanceHash(population.map(({ state, scopeHash, erasableRecordCount }) => ({
          retentionStateId: state.id, scopeHash, erasableRecordCount,
        })).sort((left, right) => left.retentionStateId.localeCompare(right.retentionStateId))),
        eligibleScopeCount: population.length,
        erasableRecordCount: population.reduce((total, item) => total + item.erasableRecordCount, 0),
      } });
      impactByPolicy.set(policyVersionId, impact);
    }
    for (const { state, scope, erasableRecordCount, scopeHash } of pending) {
      const operationKeyHash = performanceErasureOperationIdentity({ aggregateType: state.aggregateType, aggregateId: state.aggregateId,
        policyVersionId: state.policyVersionId, retentionStateId: state.id, scopeHash });
      const payload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_ERASURE_OPERATION', aggregateId: operationKeyHash,
        payloadKind: 'ERASURE_SCOPE', schemaVersion: 1, payload: { schemaVersion: 1, ...scope }, keyring: performanceVaultKeyFromEnvironment() });
      const impact = impactByPolicy.get(state.policyVersionId)!;
      const operation = await tx.performanceErasureOperation.create({ data: {
        operationKeyHash, retentionStateId: state.id, aggregateType: state.aggregateType, aggregateIdHash: sha256(state.aggregateId),
        policyVersionId: state.policyVersionId, encryptedScopeId: payload.id, scopeHash,
        dependencyHash: canonicalPerformanceHash({ handoffs: scope.graph.consequenceHandoffIds, exports: scope.verifiedExportDependencies }),
        status: impact.approvedAt ? 'COPY_REVIEW_REQUIRED' : 'PENDING_IMPACT_APPROVAL',
        recordCount: erasableRecordCount, bulkThreshold,
      } });
      await tx.performanceRecoverableCopy.createMany({ data: requiredPerformanceCopyLocations.map((location) => ({
        operationId: operation.id, location, copyKeyHash: canonicalPerformanceHash({ operationId: operation.id, location, initial: true }),
        status: location === 'LIVE_DATABASE' ? 'PRESENT' : ['SEARCH_INDEX', 'APPLICATION_CACHE'].includes(location) ? 'VERIFIED_ABSENT' : 'UNKNOWN',
        evidenceHash: ['SEARCH_INDEX', 'APPLICATION_CACHE'].includes(location) ? SYSTEM_ABSENCE_EVIDENCE : canonicalPerformanceHash({ location, status: 'UNINSPECTED' }),
      })) });
      discovered.push(await refreshOperationStatus(tx, operation.id, now));
    }
    return discovered;
  });
};

export const approvePerformanceErasureImpact = async (client: Client, input: { actorUserId: string; policyVersionId: string }) =>
  runPerformanceSerializableTransaction(client, async (tx) => {
    await requireRetentionPermission(tx, input.actorUserId);
    const preview = await tx.performanceErasureImpactApproval.findUnique({ where: { policyVersionId: input.policyVersionId } });
    if (!preview) throw erasureError('پیش‌نمایش اثر حذف برای این نسخه سیاست وجود ندارد.', 'PERFORMANCE_ERASURE_IMPACT_PREVIEW_REQUIRED');
    if (preview.approvedAt) return preview;
    const approved = await tx.performanceErasureImpactApproval.update({ where: { id: preview.id }, data: { approvedByUserId: input.actorUserId, approvedAt: new Date() } });
    const operations = await tx.performanceErasureOperation.findMany({ where: { policyVersionId: input.policyVersionId } });
    for (const operation of operations) await refreshOperationStatus(tx, operation.id);
    return approved;
  });

export const approvePerformanceBulkErasure = async (client: Client, input: { actorUserId: string; operationId: string; reasonCode: string }) =>
  runPerformanceSerializableTransaction(client, async (tx) => {
    const authorityHash = await requireRetentionPermission(tx, input.actorUserId);
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.reasonCode)) throw erasureError('دلیل کنترل‌شده تصویب حذف دسته‌ای الزامی است.', 'PERFORMANCE_ERASURE_REASON_REQUIRED', 422);
    const operation = await tx.performanceErasureOperation.findUnique({ where: { id: input.operationId } });
    if (!operation) throw erasureError('عملیات حذف پیدا نشد.', 'PERFORMANCE_ERASURE_OPERATION_NOT_FOUND', 404);
    const approval = await tx.performanceErasureApproval.upsert({ where: { operationId_actorUserId: { operationId: operation.id, actorUserId: input.actorUserId } },
      update: {}, create: { operationId: operation.id, actorUserId: input.actorUserId, reasonCode: input.reasonCode, authorityHash } });
    await refreshOperationStatus(tx, operation.id);
    return approval;
  });

export const recordPerformanceRecoverableCopy = async (client: Client, input: { actorUserId: string; operationId: string;
  location: PerformanceCopyLocation; copyKey: string; status: PerformanceCopyStatus; recoverableUntil?: Date; evidenceHash: string }) =>
  runPerformanceSerializableTransaction(client, async (tx) => {
    await requireRetentionPermission(tx, input.actorUserId);
    if (input.location === 'LIVE_DATABASE' || !requiredPerformanceCopyLocations.includes(input.location)
      || !['PRESENT', 'RECOVERABLE', 'VERIFIED_ABSENT', 'ERASED', 'UNKNOWN'].includes(input.status)
      || typeof input.copyKey !== 'string' || !input.copyKey.trim()) {
      throw erasureError('مشخصات نسخه قابل بازیابی معتبر نیست.', 'PERFORMANCE_COPY_EVIDENCE_INVALID', 422);
    }
    if (!/^[a-f0-9]{64}$/.test(input.evidenceHash)) throw erasureError('هش شاهد بررسی نسخه قابل بازیابی معتبر نیست.', 'PERFORMANCE_COPY_EVIDENCE_INVALID', 422);
    if (input.status === 'RECOVERABLE' && !input.recoverableUntil) throw erasureError('تاریخ خروج نسخه قابل بازیابی از چرخه الزامی است.', 'PERFORMANCE_COPY_EXPIRY_REQUIRED', 422);
    const operation = await tx.performanceErasureOperation.findUnique({ where: { id: input.operationId } });
    if (!operation) throw erasureError('عملیات حذف پیدا نشد.', 'PERFORMANCE_ERASURE_OPERATION_NOT_FOUND', 404);
    if (operation.liveErasedAt && input.location === 'INDEPENDENT_BACKUP'
      && ['ERASED', 'VERIFIED_ABSENT'].includes(input.status) && await activePerformanceErasureHold(tx, operation)) {
      throw erasureError('تا زمان رفع توقف نگهداری، حذف آخرین نسخه قابل بازیابی مجاز نیست.', 'PERFORMANCE_ERASURE_BACKUP_LEGAL_HOLD_ACTIVE');
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-erasure-copy:' + operation.id + ':' + input.location}, 0))`;
    const latest = await tx.performanceRecoverableCopy.findFirst({ where: { operationId: operation.id, location: input.location }, orderBy: { version: 'desc' } });
    const copy = await tx.performanceRecoverableCopy.create({ data: { operationId: operation.id, location: input.location,
      copyKeyHash: sha256(input.copyKey), status: input.status, recoverableUntil: input.recoverableUntil,
      evidenceHash: input.evidenceHash, checkedByUserId: input.actorUserId, checkedAt: new Date(), version: (latest?.version ?? 0) + 1 } });
    await refreshOperationStatus(tx, operation.id);
    return copy;
  });

const receipt = async (tx: Prisma.TransactionClient, input: { table: string; recordId: string; payloadId?: string; aggregateType: string;
  aggregateIdForHash: string; operation: { scopeHash: string; policyVersionId: string; dependencyHash: string }; actorUserId: string | null }) => {
  const existing = await tx.performanceDeletionReceipt.findUnique({ where: { deletedTableName_deletedRecordId: {
    deletedTableName: input.table, deletedRecordId: input.recordId,
  } } });
  if (existing) return existing;
  await tx.performanceDeletionReceipt.create({ data: { id: randomUUID(), deletedTableName: input.table, deletedRecordId: input.recordId,
    deletedPayloadId: input.payloadId, aggregateType: input.aggregateType, aggregateIdHash: sha256(input.aggregateIdForHash),
    scopeHash: input.operation.scopeHash, policyVersionId: input.operation.policyVersionId, reasonCode: 'RETENTION_EXPIRED',
    reason: 'Approved daily personnel performance retention erasure', recordCount: 1, dependencyEffectHash: input.operation.dependencyHash,
    actorUserId: input.actorUserId, authorityHash: canonicalPerformanceHash({ actorUserId: input.actorUserId, authority: 'APPROVED_DAILY_RETENTION_ERASURE' }) } });
};

const deleteLiveScope = async (tx: Prisma.TransactionClient, operation: { scopeHash: string; policyVersionId: string; dependencyHash: string },
  scope: ErasureScope, actorUserId: string | null) => {
  await tx.performanceEvaluation.updateMany({ where: { id: scope.graph.evaluationId }, data: { contextSnapshotId: null, acceptedResultId: null } });
  await tx.performanceEvaluationSection.updateMany({ where: { id: { in: scope.graph.sectionIds } }, data: { templateSnapshotId: null } });
  await tx.performanceArtifactSnapshotBinding.deleteMany({ where: { snapshotId: { in: scope.graph.snapshotIds } } });
  const targets = [
    ['performance_reviews', 'PERFORMANCE_REVIEW', scope.graph.reviewIds],
    ['performance_corrections', 'PERFORMANCE_CORRECTION', scope.graph.correctionIds],
    ['performance_accepted_results', 'ACCEPTED_RESULT', scope.graph.resultIds],
    ['performance_calculation_traces', 'CALCULATION_TRACE', scope.graph.traceIds],
    ['performance_submissions', 'PERFORMANCE_SUBMISSION', scope.graph.submissionIds],
    ['performance_drafts', 'PERFORMANCE_DRAFT', scope.graph.draftIds],
    ['performance_snapshots', 'PERFORMANCE_SNAPSHOT', scope.graph.snapshotIds],
    ['performance_audit_events', 'PERFORMANCE_AUDIT_EVENT', scope.graph.auditEventIds],
  ] as const;
  for (const [table, aggregateType, ids] of targets) {
    for (const recordId of ids) await receipt(tx, { table, recordId, aggregateType, aggregateIdForHash: recordId, operation, actorUserId });
    if (ids.length) await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = ANY($1::text[])`, ids);
  }
  const payloads = await tx.performanceEncryptedPayload.findMany({ where: { id: { in: scope.payloadIds } }, select: { id: true, aggregateType: true, aggregateId: true } });
  for (const payload of payloads) await receipt(tx, { table: 'performance_encrypted_payloads', recordId: payload.id, payloadId: payload.id,
    aggregateType: payload.aggregateType, aggregateIdForHash: payload.aggregateId, operation, actorUserId });
  if (payloads.length) await tx.performanceEncryptedPayload.deleteMany({ where: { id: { in: payloads.map(({ id }) => id) } } });
};

export const executePerformanceErasureOperation = async (client: Client, operationId: string, now = new Date(), dependencies?: {
  eraseArtifacts?: (exportIds: string[]) => Promise<void>;
}, requestingActorUserId?: string) => {
  if (requestingActorUserId) await requireRetentionPermission(client, requestingActorUserId);
  const claimed = await client.performanceErasureOperation.updateMany({ where: { id: operationId,
    status: { in: ['READY', 'RUNNING', 'PARTIAL_RESTRICTED'] }, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - retryDelayMs) } }] },
    data: { status: 'RUNNING', claimedAt: now, attemptCount: { increment: 1 }, lastFailureCode: null } });
  if (claimed.count !== 1) return runPerformanceSerializableTransaction(client, (tx) => refreshOperationStatus(tx, operationId, now));
  try {
    await runPerformanceSerializableTransaction(client, async (tx) => {
      const operation = await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operationId } });
      const scope = await readPerformancePayload<ErasureScope>(tx, operation.encryptedScopeId, performanceVaultKeyFromEnvironment());
      for (const location of requiredPerformanceCopyLocations) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-erasure-copy:' + operation.id + ':' + location}, 0))`;
      }
      const impact = await tx.performanceErasureImpactApproval.findUnique({ where: { policyVersionId: operation.policyVersionId } });
      const approvals = await tx.performanceErasureApproval.findMany({ where: { operationId }, select: { actorUserId: true } });
      if (!impact?.approvedAt) throw erasureError('تصویب اثر نخستین اجرای سیاست حذف وجود ندارد.', 'PERFORMANCE_ERASURE_IMPACT_APPROVAL_REQUIRED');
      const activeApprovers: string[] = [];
      for (const approval of approvals) if ((await activeHrActionPermissionsForUser(tx, approval.actorUserId, now)).includes('MANAGE_PERFORMANCE_RETENTION')) activeApprovers.push(approval.actorUserId);
      if (operation.recordCount > operation.bulkThreshold && new Set(activeApprovers).size < 2) throw erasureError('حذف دسته‌ای به تصویب دو عامل مستقل و همچنان مجاز نیاز دارد.', 'PERFORMANCE_ERASURE_DUAL_CONTROL_REQUIRED');
      const latestState = await assessPerformanceEvaluationRetention(tx, { actorUserId: null, evaluationId: scope.graph.evaluationId });
      if (latestState.id !== operation.retentionStateId || latestState.status !== 'PENDING_COPY_AND_RECONSTRUCTION_REVIEW') {
        throw erasureError('مبنای نگهداری پس از کشف دامنه تغییر کرده است.', 'PERFORMANCE_ERASURE_RETENTION_DRIFT');
      }
      const currentScope = await discoverGraph(tx, scope.graph.evaluationId);
      const currentScopeHash = canonicalPerformanceHash({ graph: currentScope.graph, classifiedRecords: currentScope.classifiedRecords, payloadIds: currentScope.payloadIds });
      const currentDependencyHash = canonicalPerformanceHash({ handoffs: currentScope.graph.consequenceHandoffIds, exports: currentScope.verifiedExportDependencies });
      if (currentScopeHash !== operation.scopeHash || currentDependencyHash !== operation.dependencyHash) {
        throw erasureError('دامنه یا وابستگی حذف پس از تصویب تغییر کرده است.', 'PERFORMANCE_ERASURE_SCOPE_DRIFT');
      }
      const copies = await tx.performanceRecoverableCopy.findMany({ where: { operationId }, orderBy: [{ version: 'desc' }, { id: 'desc' }] });
      const latest = new Map<string, string>();
      for (const copy of copies) if (!latest.has(copy.location)) latest.set(copy.location, copy.status);
      if (requiredPerformanceCopyLocations.some((location) => !latest.has(location) || latest.get(location) === 'UNKNOWN'
        || (location !== 'LIVE_DATABASE' && location !== 'INDEPENDENT_BACKUP' && ['PRESENT', 'RECOVERABLE'].includes(latest.get(location)!)))) {
        throw erasureError('بررسی همه نسخه‌های قابل بازیابی کامل نشده است.', 'PERFORMANCE_ERASURE_COPY_REVIEW_REQUIRED');
      }
      const actorUserId = impact.approvedByUserId;
      await (dependencies?.eraseArtifacts ?? ((exportIds) => erasePerformanceExportArtifacts(tx, exportIds, now)))(scope.graph.exportIds);
      await deleteLiveScope(tx, operation, scope, actorUserId);
      const latestLive = await tx.performanceRecoverableCopy.findFirst({ where: { operationId, location: 'LIVE_DATABASE' }, orderBy: { version: 'desc' } });
      await tx.performanceRecoverableCopy.create({ data: { operationId, location: 'LIVE_DATABASE', copyKeyHash: sha256(`live-erased:${operationId}`),
        status: 'ERASED', version: (latestLive?.version ?? 0) + 1,
        evidenceHash: canonicalPerformanceHash({ operationId, scopeHash: operation.scopeHash, erasedAt: now.toISOString() }), checkedAt: now } });
      await tx.performanceErasureOperation.update({ where: { id: operationId }, data: { liveErasedAt: now, claimedAt: null } });
    });
    return runPerformanceSerializableTransaction(client, (tx) => refreshOperationStatus(tx, operationId, now));
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'PERFORMANCE_ERASURE_STORAGE_OR_PROCESS_FAILURE';
    const operation = await client.performanceErasureOperation.update({ where: { id: operationId }, data: { status: 'PARTIAL_RESTRICTED', claimedAt: null,
      lastFailureCode: code, nextRetryAt: new Date(now.getTime() + retryDelayMs) } });
    const scope = await readPerformancePayload<ErasureScope>(client, operation.encryptedScopeId, performanceVaultKeyFromEnvironment()).catch(() => null);
    const impact = await client.performanceErasureImpactApproval.findUnique({ where: { policyVersionId: operation.policyVersionId } });
    if (scope && impact?.approvedByUserId) {
      const active = await client.performanceEvidenceRestriction.findFirst({ where: { evaluationId: scope.graph.evaluationId, status: 'ACTIVE', reasonCode: 'ERASURE_PARTIAL_FAILURE' } });
      if (!active) await client.performanceEvidenceRestriction.create({ data: { evaluationId: scope.graph.evaluationId,
        status: 'ACTIVE', reasonCode: 'ERASURE_PARTIAL_FAILURE', createdByUserId: impact.approvedByUserId, createdAt: now } });
    }
    return operation;
  }
};

export const runDailyPerformanceErasure = async (client: PrismaClient, now = new Date()) => {
  const prepared = await preparePerformanceErasureOperations(client, now);
  const retryable = await client.performanceErasureOperation.findMany({ where: { status: { in: ['READY', 'RUNNING', 'PARTIAL_RESTRICTED'] },
    OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] }, orderBy: { createdAt: 'asc' } });
  const executed: Array<Awaited<ReturnType<typeof executePerformanceErasureOperation>>> = [];
  for (const operation of retryable) executed.push(await executePerformanceErasureOperation(client, operation.id, now));
  const pendingCopies = await client.performanceErasureOperation.findMany({ where: { status: 'LIVE_ERASED_BACKUP_PENDING' } });
  for (const operation of pendingCopies) await runPerformanceSerializableTransaction(client, (tx) => refreshOperationStatus(tx, operation.id, now));
  return { prepared: prepared.length, executed };
};

export const listPerformanceErasureOperations = async (client: Client, actorUserId: string) => {
  await requireRetentionPermission(client, actorUserId);
  const [impacts, operations] = await Promise.all([
    client.performanceErasureImpactApproval.findMany({ orderBy: { createdAt: 'desc' } }),
    client.performanceErasureOperation.findMany({ orderBy: { createdAt: 'desc' } }),
  ]);
  const operationIds = operations.map(({ id }) => id);
  const [approvals, copies] = await Promise.all([
    client.performanceErasureApproval.findMany({ where: { operationId: { in: operationIds } }, orderBy: { approvedAt: 'asc' } }),
    client.performanceRecoverableCopy.findMany({ where: { operationId: { in: operationIds } }, orderBy: { checkedAt: 'desc' } }),
  ]);
  return { impacts, operations: operations.map((operation) => ({ ...operation,
    approvals: approvals.filter(({ operationId }) => operationId === operation.id),
    copies: copies.filter(({ operationId }) => operationId === operation.id),
  })) };
};

const ensureRestoreRetentionPolicyEvidence = async (
  current: Prisma.TransactionClient, safety: PrismaClient, policyVersionId: string,
) => {
  const source = await safety.performancePolicyVersion.findUnique({ where: { id: policyVersionId } });
  if (!source?.encryptedPayloadId || source.policyKind !== 'RETENTION') {
    throw erasureError('نسخه سیاست مبدأ برای بازاجرای حذف قابل تأیید نیست.', 'PERFORMANCE_RESTORE_ERASURE_POLICY_MISSING');
  }
  const content = await readPerformancePayload<unknown>(safety, source.encryptedPayloadId, performanceVaultKeyFromEnvironment());
  if (canonicalPerformanceHash(content) !== source.contentHash) {
    throw erasureError('تمامیت سیاست مبدأ برای بازاجرای حذف معتبر نیست.', 'PERFORMANCE_RESTORE_ERASURE_POLICY_INVALID');
  }
  const existing = await current.performancePolicyVersion.findUnique({ where: { id: source.id } });
  if (existing) {
    if (existing.contentHash !== source.contentHash || existing.policyKind !== source.policyKind
      || existing.version !== source.version || existing.predecessorId !== source.predecessorId) {
      throw erasureError('شناسه سیاست بازیابی‌شده با شاهد حذف تعارض دارد.', 'PERFORMANCE_RESTORE_ERASURE_POLICY_CONFLICT');
    }
    return existing;
  }
  if (source.version > 1) {
    if (!source.predecessorId) throw erasureError('زنجیره نسخه سیاست مبدأ ناقص است.', 'PERFORMANCE_RESTORE_ERASURE_POLICY_LINEAGE_INVALID');
    await ensureRestoreRetentionPolicyEvidence(current, safety, source.predecessorId);
  }
  const conflictingVersion = await current.performancePolicyVersion.findUnique({ where: {
    policyKind_version: { policyKind: 'RETENTION', version: source.version },
  } });
  if (conflictingVersion) {
    throw erasureError('نسخه سیاست بازیابی‌شده با زنجیره موجود تعارض دارد.', 'PERFORMANCE_RESTORE_ERASURE_POLICY_CONFLICT');
  }
  const creator = await current.user.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  if (!creator) throw erasureError('عامل سیستمی برای حفظ شاهد سیاست بازیابی وجود ندارد.', 'PERFORMANCE_RESTORE_ERASURE_CREATOR_MISSING');
  const encrypted = await persistPerformancePayload(current, {
    aggregateType: 'PERFORMANCE_RESTORE_POLICY_EVIDENCE', aggregateId: source.id,
    payloadKind: 'RETENTION_POLICY', schemaVersion: 1, payload: content,
    keyring: performanceVaultKeyFromEnvironment(),
  });
  return current.performancePolicyVersion.create({ data: {
    id: source.id, policyKind: 'RETENTION', version: source.version, predecessorId: source.predecessorId,
    lifecycle: 'DRAFT', contentHash: source.contentHash, encryptedPayloadId: encrypted.id,
    publicationReason: 'SYSTEM_RECOVERY_ERASURE_REPLAY_EVIDENCE', createdByUserId: creator.id,
    createdAt: source.createdAt,
  } });
};

export const replayPerformanceErasureAfterRestore = async (current: PrismaClient, safety: PrismaClient, now = new Date()) => {
  const prior = await safety.performanceErasureOperation.findMany({ where: { liveErasedAt: { not: null } }, orderBy: { liveErasedAt: 'asc' } });
  let replayed = 0;
  for (const source of prior) {
    const scope = await readPerformancePayload<ErasureScope>(safety, source.encryptedScopeId, performanceVaultKeyFromEnvironment());
    const expectedIdentity = performanceErasureOperationIdentity({ aggregateType: source.aggregateType,
      aggregateId: scope.graph.evaluationId, policyVersionId: source.policyVersionId,
      retentionStateId: source.retentionStateId, scopeHash: source.scopeHash });
    const scopeHash = canonicalPerformanceHash({ graph: scope.graph, classifiedRecords: scope.classifiedRecords, payloadIds: scope.payloadIds });
    const dependencyHash = canonicalPerformanceHash({ handoffs: scope.graph.consequenceHandoffIds, exports: scope.verifiedExportDependencies });
    if (expectedIdentity !== source.operationKeyHash || scopeHash !== source.scopeHash || dependencyHash !== source.dependencyHash) {
      throw erasureError('تمامیت عملیات حذف مبدأ برای بازاجرا معتبر نیست.', 'PERFORMANCE_RESTORE_ERASURE_SCOPE_INVALID');
    }
    const copyRows = await safety.performanceRecoverableCopy.findMany({ where: { operationId: source.id }, orderBy: [{ version: 'desc' }, { id: 'desc' }] });
    const latestCopies = new Map<string, string>();
    for (const copy of copyRows) if (!latestCopies.has(copy.location)) latestCopies.set(copy.location, copy.status);
    if (latestCopies.get('LIVE_DATABASE') !== 'ERASED' || requiredPerformanceCopyLocations
      .filter((location) => !['LIVE_DATABASE', 'INDEPENDENT_BACKUP'].includes(location))
      .some((location) => !['VERIFIED_ABSENT', 'ERASED'].includes(latestCopies.get(location) ?? 'UNKNOWN'))) {
      throw erasureError('شواهد نسخه‌های قابل بازیابی برای بازاجرای حذف کامل نیست.', 'PERFORMANCE_RESTORE_ERASURE_COPY_EVIDENCE_INVALID');
    }
    await runPerformanceSerializableTransaction(current, async (tx) => {
      await ensureRestoreRetentionPolicyEvidence(tx, safety, source.policyVersionId);
      await erasePerformanceExportArtifacts(tx, scope.graph.exportIds, now);
      await deleteLiveScope(tx, source, scope, null);
    });
    replayed += 1;
  }
  return { replayed, verifiedAt: now };
};
