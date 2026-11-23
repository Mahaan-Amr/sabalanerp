import { Prisma, type PrismaClient } from '@prisma/client';
import { LOADING_CANCELLATION_DUTY as code } from './loadingCancellationDutyCode';
import type { CrossWorkspaceDutyDatabase, CrossWorkspaceDutySourceAdapter } from './types';

const sourceType = 'LOGISTICS_LOADING_CANCELLATION';
const dutyScope = { sourceType, sourceActionCode: code };
const definition = {
  sourceActionCode: code, envelopeCode: code, envelopeVersion: 1,
  destinationWorkspaceCode: 'ACCOUNTING',
  accountabilityModel: 'SHARED_DECISION' as const, workspaceAdminOverrideDenied: true,
  allowedFields: ['title', 'description'], allowedEvidence: [], allowedActionCodes: ['APPROVE', 'DECLINE'],
  responseSchema: {
    type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE', 'DECLINE'] },
      reason: { type: ['string', 'null'] } }, required: ['actionCode', 'reason'], additionalProperties: false,
  },
};
export const LOADING_CANCELLATION_DUTY_DEFINITIONS = { [code]: definition };

const lockLoading = (tx: CrossWorkspaceDutyDatabase, loadingId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`LOGISTICS_LOADING:${loadingId}`}))`;

type Document = { id: string; number: string; kind: 'INVOICE' | 'WAYBILL' };
type RequestSnapshot = { loadingNumber: string | null; reason: string; documents: Document[] };

export async function readLoadingCancellationDocuments(db: CrossWorkspaceDutyDatabase, loadingId: string) {
  const loading = await db.logisticsLoading.findUnique({
    where: { id: loadingId, sourceKind: 'SALES_CONTRACT' },
    select: {
      loadingNumber: true, status: true, finalizedAt: true,
      salesDispatchInvoices: { where: { voidedAt: null }, select: { id: true, number: true } },
      guardQueueTurns: { select: { status: true, physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } } } },
      canonicalAllocationRevisions: { select: {
        physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } },
        candidate: { select: { waybills: { select: {
          id: true, number: true, status: true, physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } },
        } } } },
      } },
    },
  });
  if (!loading) return null;
  const waybills = loading.canonicalAllocationRevisions.flatMap(revision => revision.candidate?.waybills ?? []);
  const documents: Document[] = [
    ...loading.salesDispatchInvoices.map(doc => ({ id: doc.id, number: doc.number.toString(), kind: 'INVOICE' as const })),
    ...waybills.filter(doc => doc.status === 'ISSUED').map(doc => ({ id: doc.id, number: doc.number.toString(), kind: 'WAYBILL' as const })),
  ];
  const eligible = (loading.status === 'FINALIZED' || loading.status === 'CANCELLED' && Boolean(loading.finalizedAt))
    && loading.guardQueueTurns.length > 0 && loading.canonicalAllocationRevisions.length > 0
    && loading.guardQueueTurns.every(turn => turn.status === 'LOADING_FINALIZED' && !turn.physicalExit && !turn.manualOutageExit)
    && loading.canonicalAllocationRevisions.every(revision => !revision.physicalExit && !revision.manualOutageExit)
    && waybills.every(doc => doc.status !== 'EXIT_RECORDED' && !doc.physicalExit && !doc.manualOutageExit);
  return { loadingNumber: loading.loadingNumber, documents, eligible };
}

export async function latestLoadingCancellationRequest(db: CrossWorkspaceDutyDatabase, loadingId: string) {
  const duty = await db.crossWorkspaceDuty.findFirst({
    where: { ...dutyScope, sourceId: loadingId }, orderBy: { sourceVersion: 'desc' },
    select: { id: true, status: true, sourceVersion: true, createdAt: true, structuredResultJson: true },
  });
  if (!duty) return null;
  const result = duty.structuredResultJson as { actionCode?: string; reason?: string } | null;
  return { id: duty.id, sourceVersion: duty.sourceVersion, createdAt: duty.createdAt,
    status: duty.status === 'OPEN' ? 'PENDING' : result?.actionCode === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    reason: result?.reason ?? null };
}

export async function requestLoadingCancellation(db: PrismaClient, input: {
  loadingId: string; actorId: string; reason: string;
}) {
  const { DispatchAllocationConflictError } = await import('../dispatchAllocation');
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 2000) throw new DispatchAllocationConflictError('دلیل لغو باید بین ۳ تا ۲۰۰۰ نویسه باشد.');
  return db.$transaction(async tx => {
    await lockLoading(tx, input.loadingId);
    const latest = await latestLoadingCancellationRequest(tx, input.loadingId);
    if (latest?.status === 'PENDING') return latest;
    const loading = await readLoadingCancellationDocuments(tx, input.loadingId);
    if (!loading?.eligible) throw new DispatchAllocationConflictError('ثبت درخواست لغو فقط برای بارگیری نهایی‌شده پیش از خروج ممکن است.');
    if (!loading.documents.length) throw new DispatchAllocationConflictError('سند فعالی برای ابطال وجود ندارد. صفحه را به‌روز کنید و بارگیری را مستقیم لغو کنید.');
    const envelope = {
      destinationWorkspaceCode: definition.destinationWorkspaceCode,
      destinationFeatureCode: 'accounting_dispatch_candidates_manage',
      allowedFieldsJson: definition.allowedFields, allowedEvidenceJson: definition.allowedEvidence,
      allowedActionCodesJson: definition.allowedActionCodes, responseSchemaJson: definition.responseSchema,
    };
    await tx.crossWorkspaceDutyEnvelope.upsert({
      where: { code_version: { code, version: 1 } },
      update: {}, create: { ...envelope, code, version: 1, createdByUserId: input.actorId },
    });
    const sourceVersion = (latest?.sourceVersion ?? 0) + 1;
    const snapshot: RequestSnapshot = { loadingNumber: loading.loadingNumber, reason, documents: loading.documents };
    await tx.crossWorkspaceDuty.create({ data: {
      ...dutyScope, stableKey: `${code}:${input.loadingId}:${sourceVersion}`, sourceId: input.loadingId, sourceVersion,
      envelopeCode: code, envelopeVersion: 1, destinationWorkspaceCode: definition.destinationWorkspaceCode,
      destinationQueueCode: code, sourceActorUserId: input.actorId, createdByUserId: input.actorId,
      predecessorDutyId: latest?.id,
      auditVersions: { create: { version: 1, eventCode: 'REQUESTED', actorUserId: input.actorId,
        sourceVersion, envelopeVersion: 1, policyVersion: 1, reason, afterJson: snapshot } },
    } });
    return latestLoadingCancellationRequest(tx, input.loadingId);
  });
}

export const loadingCancellationDutyAdapter: CrossWorkspaceDutySourceAdapter = {
  sourceType,
  synchronize: async () => { throw new Error('DUTY_SOURCE_NOT_ACTIONABLE'); },
  canAccessSharedDecision: async (db, input) => {
    const { loadingCancellationAccountingAuthority } = await import('../dispatchAllocation');
    const duty = await db.crossWorkspaceDuty.findFirst({ where: { ...dutyScope, id: input.dutyId }, select: { status: true } });
    return Boolean(duty && (duty.status === 'OPEN' || input.includeCompleted)
      && await loadingCancellationAccountingAuthority(db, input.actorUserId));
  },
  loadInboxProjection: async (db, input) => {
    const duty = await db.crossWorkspaceDuty.findFirst({
      where: { ...dutyScope, sourceId: input.sourceId, sourceVersion: input.sourceVersion },
      select: { status: true, auditVersions: { where: { version: 1 }, select: { afterJson: true } } },
    });
    const snapshot = duty?.auditVersions[0]?.afterJson as RequestSnapshot | undefined;
    const loadingLabel = snapshot?.loadingNumber ? ` — ${snapshot.loadingNumber}` : '';
    const formattedDocuments = snapshot?.documents.map(doc =>
      `${doc.kind === 'INVOICE' ? 'فاکتور فروش' : 'بارنامه'} شمارهٔ ${doc.number}`).join('، ');
    return { title: `درخواست لغو بارگیری${loadingLabel}`,
      description: snapshot ? `دلیل لغو: ${snapshot.reason}\nاسناد برای ابطال: ${formattedDocuments}` : null,
      sourceIsCurrent: duty?.status === 'OPEN' && Boolean(snapshot) };
  },
  respond: async (tx, input) => {
    const { cancelFinalizedOrdinaryLoadingInTransaction, DispatchAllocationConflictError,
      LoadingCancellationAccountingAccessError, loadingCancellationAccountingAuthority } = await import('../dispatchAllocation');
    const duty = await tx.crossWorkspaceDuty.findFirst({
      where: { ...dutyScope, id: input.dutyId },
      include: { auditVersions: { where: { version: 1 } } },
    });
    if (!duty) throw new Error('DUTY_NOT_AVAILABLE');
    await tx.$queryRaw`SELECT id FROM users WHERE id=${input.actorUserId} FOR UPDATE`;
    await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id=1 FOR UPDATE`;
    await lockLoading(tx, duty.sourceId);
    if (!await loadingCancellationAccountingAuthority(tx, input.actorUserId)) throw new Error('DUTY_NOT_AVAILABLE');
    if (input.expectedSourceVersion !== duty.sourceVersion || input.expectedEnvelopeVersion !== duty.envelopeVersion) {
      throw new Error('SOURCE_VERSION_CHANGED');
    }
    if (!definition.allowedActionCodes.includes(input.actionCode)) throw new Error('ACTION_NOT_ALLOWED');
    const reason = input.reason?.trim() || null;
    if (input.actionCode === 'DECLINE' && (!reason || reason.length < 3 || reason.length > 2000)) throw new Error('REASON_REQUIRED');
    const snapshot = duty.auditVersions[0]?.afterJson as RequestSnapshot | undefined;
    if (!snapshot) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
    const at = input.now ?? new Date();
    const result = { actionCode: input.actionCode, reason };
    const changed = await tx.crossWorkspaceDuty.updateMany({
      where: { id: duty.id, status: 'OPEN' },
      data: { status: 'COMPLETED', structuredResultJson: result, respondedAt: at, respondedByUserId: input.actorUserId },
    });
    if (!changed.count) throw new Error('DUTY_ALREADY_DECIDED');
    if (input.actionCode === 'APPROVE') {
      try {
        await cancelFinalizedOrdinaryLoadingInTransaction(tx, {
          loadingId: duty.sourceId, actorId: input.actorUserId, reason: snapshot.reason,
          expectedDocumentIds: snapshot.documents.map(doc => doc.id),
          allowPreviouslyVoidedDocuments: true,
        });
      } catch (error) {
        if (error instanceof LoadingCancellationAccountingAccessError) throw new Error('DUTY_NOT_AVAILABLE');
        if (error instanceof DispatchAllocationConflictError) throw new Error('DUTY_LOADING_CANCELLATION_CHANGED');
        throw error;
      }
    }
    await tx.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: 2,
      eventCode: 'COMPLETED', actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion,
      envelopeVersion: duty.envelopeVersion, policyVersion: input.policyVersion, reason, afterJson: result } });
    return { duty: await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }) };
  },
  claim: async () => { throw new Error('DUTY_NOT_CLAIMABLE'); },
  canClaim: async () => false, claimRequiresReason: async () => false, responseRequiresReason: async () => false,
  canReassign: async () => false, reassign: async () => { throw new Error('DUTY_REASSIGNMENT_NOT_ALLOWED'); },
  listEligibleAssignees: async () => [], reconcileAssignment: async () => null,
};
