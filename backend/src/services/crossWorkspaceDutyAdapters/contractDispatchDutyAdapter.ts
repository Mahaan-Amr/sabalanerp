import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter, CrossWorkspaceDutyDatabase } from './types';
import { canManageDispatch, canReviewManagerDispatch, decideDispatchRequest } from '../contractDispatchCredit';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';
import { canManageCustomerCredit } from '../specialCustomerCredit';
import { publishNotificationEvent } from '../notificationService';

const definition = (code: string, workspace: string, shared: boolean) => ({
  sourceActionCode: code, envelopeCode: code, envelopeVersion: 1, destinationWorkspaceCode: workspace,
  accountabilityModel: shared ? 'SHARED_DECISION' as const : 'INDIVIDUAL_EXECUTION' as const,
  workspaceAdminOverrideDenied: !shared,
  allowedFields: ['title', 'description', 'dueAt'], allowedEvidence: [], allowedActionCodes: ['APPROVE', 'DECLINE'],
  responseSchema: { type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE','DECLINE'] },
    reason: { type: ['string','null'] }, ...(shared ? { promisedDate: { type: 'string' } } : {}) }, required: ['actionCode','reason'], additionalProperties: false },
});
export const CONTRACT_DISPATCH_DUTY_DEFINITIONS = {
  CONTRACT_DISPATCH_DECISION: definition('CONTRACT_DISPATCH_DECISION', 'ACCOUNTING', true),
  CONTRACT_CREDIT_TRANSFER: definition('CONTRACT_CREDIT_TRANSFER', 'SALES', false),
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const upsertContractDispatchEnvelope = (db: CrossWorkspaceDutyDatabase, d: ReturnType<typeof definition>, actorId: string) => {
  const data = { destinationWorkspaceCode: d.destinationWorkspaceCode, destinationFeatureCode: 'ACCOUNTING_ACTIONS_MANAGE',
    allowedFieldsJson: d.allowedFields, allowedEvidenceJson: d.allowedEvidence, allowedActionCodesJson: d.allowedActionCodes,
    responseSchemaJson: json(d.responseSchema), isActive: true };
  return db.crossWorkspaceDutyEnvelope.upsert({ where: { code_version: { code: d.envelopeCode, version: 1 } },
    update: data, create: { ...data, code: d.envelopeCode, version: 1, createdByUserId: actorId } });
};
export const syncContractDispatchDutyDefinitions = async (db: CrossWorkspaceDutyDatabase, actorId: string) => {
  const envelopes: Awaited<ReturnType<typeof upsertContractDispatchEnvelope>>[] = [];
  for (const d of Object.values(CONTRACT_DISPATCH_DUTY_DEFINITIONS)) envelopes.push(await upsertContractDispatchEnvelope(db, d, actorId));
  return envelopes;
};
export const createContractDispatchDuty = async (db: CrossWorkspaceDutyDatabase, requestId: string) => {
  const request = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id: requestId }, include: { contract: true } });
  const d = request.kind === 'TRANSFER' ? CONTRACT_DISPATCH_DUTY_DEFINITIONS.CONTRACT_CREDIT_TRANSFER
    : CONTRACT_DISPATCH_DUTY_DEFINITIONS.CONTRACT_DISPATCH_DECISION;
  await upsertContractDispatchEnvelope(db, d, request.requestedBy);
  const duty = await db.crossWorkspaceDuty.create({ data: { stableKey: `CONTRACT_DISPATCH:${request.id}`,
    sourceType: 'CONTRACT_DISPATCH', sourceId: request.id, sourceActionCode: d.sourceActionCode, sourceVersion: request.revision,
    envelopeCode: d.envelopeCode, envelopeVersion: 1, destinationWorkspaceCode: d.destinationWorkspaceCode,
    destinationQueueCode: d.sourceActionCode, currentAssigneeUserId: request.kind === 'TRANSFER' ? request.targetSellerId : null,
    sourceActorUserId: request.requestedBy, createdByUserId: request.requestedBy, dueAt: request.promisedDate } });
  await db.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED',
    actorUserId: request.requestedBy, sourceVersion: request.revision, envelopeVersion: 1, policyVersion: 1,
    afterJson: json({ status: 'OPEN', requestId: request.id }) } });
  if (request.kind === 'TRANSFER') await db.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id, sequence: 1, assignedUserId: request.targetSellerId, destinationWorkspaceCode: 'SALES',
    destinationQueueCode: d.sourceActionCode, startedAt: new Date(), changedByUserId: request.requestedBy, policyVersion: 1 } });
  if (request.kind === 'MANAGER') {
    const candidates = await db.user.findMany({ where: { isActive: true, role: { in: ['ADMIN', 'MANAGER'] }, id: { not: request.requestedBy } }, select: { id: true } });
    const recipients: string[] = [];
    for (const candidate of candidates) if (await canReviewManagerDispatch(db, candidate.id)) recipients.push(candidate.id);
    await publishNotificationEvent(db, { type: 'CONTRACT_MANAGER_DISPATCH_REQUESTED',
      deduplicationKey: `manager-dispatch-requested:${request.id}`, recipientIds: recipients, actorId: request.requestedBy,
      resourceType: 'CONTRACT_DISPATCH', resourceId: request.contractId, referenceId: request.id,
      actionUrl: `/dashboard/accounting/contracts/${request.contractId}`,
      payload: { contractNumber: request.contract.contractNumber } });
  }
  return duty;
};
export const closeContractDispatchDuty = async (db: CrossWorkspaceDutyDatabase, requestId: string, actorId: string,
  action: string, reason?: string) => {
  const duty = await db.crossWorkspaceDuty.findUnique({ where: { stableKey: `CONTRACT_DISPATCH:${requestId}` } });
  if (!duty || duty.status !== 'OPEN') return;
  const completed = ['APPROVE','DECLINE'].includes(action);
  const authority = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id: requestId } });
  await db.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { status: completed ? 'COMPLETED' : 'CANCELLED',
    respondedAt: completed ? new Date() : null, respondedByUserId: completed ? actorId : null, structuredResultJson: json({ actionCode: action, reason: reason ?? null,
      ...(authority.kind === 'MANAGER' && action === 'APPROVE' ? { promisedDate: authority.promisedDate } : {}) }) } });
  await db.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: new Date(), changedByUserId: actorId, endReason: completed ? 'COMPLETED' : 'CANCELLED' } });
  const maximum = await db.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
  await db.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: (maximum._max.version ?? 0) + 1,
    eventCode: completed ? 'COMPLETED' : 'CANCELLED', actorUserId: actorId, sourceVersion: duty.sourceVersion,
    envelopeVersion: 1, policyVersion: 1, reason: reason ?? null, afterJson: json({ actionCode: action }) } });
};
export const contractDispatchDutyAdapter: CrossWorkspaceDutySourceAdapter = {
  sourceType: 'CONTRACT_DISPATCH',
  synchronize: (db, input) => createContractDispatchDuty(db, input.sourceId),
  respond: async (db, input) => {
    const duty = await db.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: input.dutyId } });
    if (duty.status !== 'OPEN' || duty.sourceVersion !== input.expectedSourceVersion || input.expectedEnvelopeVersion !== 1
      || !['APPROVE','DECLINE'].includes(input.actionCode)) throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
    const result = await decideDispatchRequest(db, duty.sourceId, input.actorUserId, input.actionCode as 'APPROVE' | 'DECLINE', input.reason ?? undefined, input.promisedDate);
    await closeContractDispatchDuty(db, duty.sourceId, input.actorUserId, input.actionCode, input.reason ?? undefined);
    const contract = await db.salesContract.findUniqueOrThrow({ where: { id: result.contractId } });
    await db.salesContract.update({ where: { id: contract.id }, data: { dispatchExpiryExempt: await ordinaryContractDispatchEligible(db, contract) } });
    return { duty: await db.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } }) };
  },
  claim: async () => { throw new Error('DUTY_NOT_CLAIMABLE'); }, canClaim: async () => false,
  claimRequiresReason: async () => false, responseRequiresReason: async () => false,
  canAccessSharedDecision: async (db, input) => {
    const duty = await db.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    if (!duty || duty.sourceType !== 'CONTRACT_DISPATCH' || duty.sourceActionCode !== 'CONTRACT_DISPATCH_DECISION'
      || (!input.includeCompleted && duty.status !== 'OPEN')) return false;
    const request = await db.contractDispatchAuthority.findUnique({ where: { id: duty.sourceId }, select: { kind: true, requestedBy: true } });
    if (request?.kind === 'MANAGER') return (input.includeCompleted || request.requestedBy !== input.actorUserId)
      && await canReviewManagerDispatch(db, input.actorUserId);
    return request?.kind === 'CUSTOMER_DATE' ? canManageCustomerCredit(db, input.actorUserId) : canManageDispatch(db, input.actorUserId);
  },
  canReassign: async () => false, reassign: async () => { throw new Error('DUTY_REASSIGNMENT_NOT_ALLOWED'); },
  listEligibleAssignees: async () => [], reconcileAssignment: async () => null,
  loadInboxProjection: async (db, input) => {
    const request = await db.contractDispatchAuthority.findUnique({ where: { id: input.sourceId }, include: { contract: { include: { customer: { select: { firstName: true, lastName: true } } } } } });
    if (!request) {
      const archived = await db.accountingAuditLog.findFirst({ where: { entityId: input.sourceId, action: 'DISPATCH_AUTHORITY_ARCHIVED_BY_HARD_DELETE' }, orderBy: { createdAt: 'desc' } });
      const before = archived?.beforeState as { contractNumber?: string } | null;
      return { title: `سابقه مجوز یا ضمانت — ${before?.contractNumber ?? ''}`, description: 'قرارداد از مسیر مجاز حذف شده و سابقه تصمیم در ممیزی حفظ شده است.', sourceIsCurrent: false };
    }
    return { title: `${request?.kind === 'TRANSFER' ? 'پذیرش انتقال ضمانت' : ['DATE','CUSTOMER_DATE'].includes(request.kind) ? 'تغییر وعده پرداخت' : 'درخواست تأیید مدیریتی'} — ${request?.contract.contractNumber ?? ''}`,
      description: `مشتری: ${[request.contract.customer.firstName, request.contract.customer.lastName].filter(Boolean).join(' ')}\n${request.promisedDate ? `وعده پرداخت: ${request.promisedDate.toLocaleDateString('fa-IR', { timeZone: 'UTC' })}` : 'تاریخ وعده پرداخت هنگام تأیید تعیین می‌شود.'}${request.reason ? ` — ${request.reason}` : ''}`,
      sourceIsCurrent: !!request && request.status === 'PENDING' && request.revision === request.contract.commercialRevision
        && !request.contract.isInactive && !['CANCELLED','EXPIRED'].includes(request.contract.status),
      destinationHref: `/dashboard/accounting/contracts/${request?.contractId ?? ''}` };
  },
};
