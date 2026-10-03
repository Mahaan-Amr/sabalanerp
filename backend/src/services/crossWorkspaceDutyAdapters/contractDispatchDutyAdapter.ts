import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter, CrossWorkspaceDutyDatabase } from './types';
import { canManageDispatch, decideDispatchRequest } from '../contractDispatchCredit';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';

const definition = (code: string, workspace: string, shared: boolean) => ({
  sourceActionCode: code, envelopeCode: code, envelopeVersion: 1, destinationWorkspaceCode: workspace,
  accountabilityModel: shared ? 'SHARED_DECISION' as const : 'INDIVIDUAL_EXECUTION' as const,
  workspaceAdminOverrideDenied: !shared,
  allowedFields: ['title', 'description', 'dueAt'], allowedEvidence: [], allowedActionCodes: ['APPROVE', 'DECLINE'],
  responseSchema: { type: 'object', properties: { actionCode: { type: 'string', enum: ['APPROVE','DECLINE'] },
    reason: { type: ['string','null'] } }, required: ['actionCode','reason'], additionalProperties: false },
});
export const CONTRACT_DISPATCH_DUTY_DEFINITIONS = {
  CONTRACT_DISPATCH_DECISION: definition('CONTRACT_DISPATCH_DECISION', 'ACCOUNTING', true),
  CONTRACT_CREDIT_TRANSFER: definition('CONTRACT_CREDIT_TRANSFER', 'SALES', false),
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const createContractDispatchDuty = async (db: CrossWorkspaceDutyDatabase, requestId: string) => {
  const request = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id: requestId } });
  const d = request.kind === 'TRANSFER' ? CONTRACT_DISPATCH_DUTY_DEFINITIONS.CONTRACT_CREDIT_TRANSFER
    : CONTRACT_DISPATCH_DUTY_DEFINITIONS.CONTRACT_DISPATCH_DECISION;
  const envelopeData = { destinationWorkspaceCode: d.destinationWorkspaceCode, destinationFeatureCode: 'ACCOUNTING_ACTIONS_MANAGE',
    allowedFieldsJson: d.allowedFields, allowedEvidenceJson: d.allowedEvidence, allowedActionCodesJson: d.allowedActionCodes,
    responseSchemaJson: json(d.responseSchema), isActive: true };
  await db.crossWorkspaceDutyEnvelope.upsert({ where: { code_version: { code: d.envelopeCode, version: 1 } },
    update: envelopeData, create: { ...envelopeData, code: d.envelopeCode, version: 1, createdByUserId: request.requestedBy } });
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
  return duty;
};
export const closeContractDispatchDuty = async (db: CrossWorkspaceDutyDatabase, requestId: string, actorId: string,
  action: string, reason?: string) => {
  const duty = await db.crossWorkspaceDuty.findUnique({ where: { stableKey: `CONTRACT_DISPATCH:${requestId}` } });
  if (!duty || duty.status !== 'OPEN') return;
  const completed = ['APPROVE','DECLINE'].includes(action);
  await db.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { status: completed ? 'COMPLETED' : 'CANCELLED',
    respondedAt: new Date(), respondedByUserId: actorId, structuredResultJson: json({ actionCode: action, reason: reason ?? null }) } });
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
    const result = await decideDispatchRequest(db, duty.sourceId, input.actorUserId, input.actionCode as 'APPROVE' | 'DECLINE', input.reason ?? undefined);
    await closeContractDispatchDuty(db, duty.sourceId, input.actorUserId, input.actionCode, input.reason ?? undefined);
    const contract = await db.salesContract.findUniqueOrThrow({ where: { id: result.contractId } });
    await db.salesContract.update({ where: { id: contract.id }, data: { dispatchExpiryExempt: await ordinaryContractDispatchEligible(db, contract) } });
    return result;
  },
  claim: async () => { throw new Error('DUTY_NOT_CLAIMABLE'); }, canClaim: async () => false,
  claimRequiresReason: async () => false, responseRequiresReason: async () => false,
  canAccessSharedDecision: async (db, input) => {
    const duty = await db.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    if (!duty || duty.sourceType !== 'CONTRACT_DISPATCH' || duty.sourceActionCode !== 'CONTRACT_DISPATCH_DECISION'
      || (!input.includeCompleted && duty.status !== 'OPEN')) return false;
    return canManageDispatch(db, input.actorUserId);
  },
  canReassign: async () => false, reassign: async () => { throw new Error('DUTY_REASSIGNMENT_NOT_ALLOWED'); },
  listEligibleAssignees: async () => [], reconcileAssignment: async () => null,
  loadInboxProjection: async (db, input) => {
    const request = await db.contractDispatchAuthority.findUnique({ where: { id: input.sourceId }, include: { contract: true } });
    if (!request) {
      const archived = await db.accountingAuditLog.findFirst({ where: { entityId: input.sourceId, action: 'DISPATCH_AUTHORITY_ARCHIVED_BY_HARD_DELETE' }, orderBy: { createdAt: 'desc' } });
      const before = archived?.beforeState as { contractNumber?: string } | null;
      return { title: `سابقه مجوز یا ضمانت — ${before?.contractNumber ?? ''}`, description: 'قرارداد از مسیر مجاز حذف شده و سابقه تصمیم در ممیزی حفظ شده است.', sourceIsCurrent: false };
    }
    return { title: `${request?.kind === 'TRANSFER' ? 'پذیرش انتقال ضمانت' : request?.kind === 'DATE' ? 'تغییر وعده پرداخت' : 'درخواست تأیید مدیریتی'} — ${request?.contract.contractNumber ?? ''}`,
      description: request ? `وعده پرداخت: ${request.promisedDate.toLocaleDateString('fa-IR', { timeZone: 'UTC' })}${request.reason ? ` — ${request.reason}` : ''}` : null,
      sourceIsCurrent: !!request && request.status === 'PENDING' && request.revision === request.contract.commercialRevision
        && !request.contract.isInactive && !['CANCELLED','EXPIRED'].includes(request.contract.status),
      destinationHref: `/dashboard/accounting/contracts/${request?.contractId ?? ''}` };
  },
};
