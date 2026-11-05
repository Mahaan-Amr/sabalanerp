import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';
import type { Tx } from '../purchasing/repository';

const definition = {
  sourceActionCode: 'PURCHASING_INQUIRY_REVIEW', envelopeCode: 'PURCHASING_INQUIRY_REVIEW', envelopeVersion: 1,
  destinationWorkspaceCode: 'PURCHASING', accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
  workspaceAdminOverrideDenied: false, allowedFields: ['title', 'description', 'dueAt'] as const,
  allowedActionCodes: [] as string[], allowedEvidence: [] as string[],
  responseSchema: { type: 'object', properties: {}, additionalProperties: false },
};
export const PURCHASING_INQUIRY_DUTY_DEFINITIONS = { PURCHASING_INQUIRY_REVIEW: definition } as const;
const displayText = (value: unknown) => String(value ?? '').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '').replace(/\bc[a-z0-9]{24,}\b/gi, '').replace(/\s+/g, ' ').trim();
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export async function syncPurchasingInquiryDutyDefinitions(db: any, actorId = 'SYSTEM') {
  const values = { destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationFeatureCode: 'PURCHASING_INQUIRY_REVIEW', allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [], allowedActionCodesJson: [], responseSchemaJson: asJson(definition.responseSchema), isActive: true };
  return [await db.crossWorkspaceDutyEnvelope.upsert({ where: { code_version: { code: definition.envelopeCode, version: 1 } }, update: values, create: { ...values, code: definition.envelopeCode, version: 1, createdByUserId: actorId } })];
}
export async function createPurchasingInquiryDuty(tx: Tx, doc: {id: string; ownerId: string; creatorId: string}, actorId: string) {
  if (doc.ownerId === doc.creatorId) return;
  await syncPurchasingInquiryDutyDefinitions(tx, actorId);
  const duty = await tx.crossWorkspaceDuty.create({ data: { stableKey: `PURCHASING_INQUIRY:${doc.id}`, sourceType: 'PURCHASING_INQUIRY', sourceId: doc.id, sourceActionCode: definition.sourceActionCode, sourceVersion: 1, envelopeCode: definition.envelopeCode, envelopeVersion: 1, destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode, currentAssigneeUserId: doc.ownerId, sourceActorUserId: actorId, createdByUserId: actorId } });
  await tx.crossWorkspaceDutyAssignmentHistory.create({ data: { dutyId: duty.id, sequence: 1, assignedUserId: doc.ownerId, destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode, changedByUserId: actorId, policyVersion: 1 } });
  await tx.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: actorId, sourceVersion: 1, envelopeVersion: 1, policyVersion: 1, afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: doc.ownerId }) } });
}
export async function closePurchasingInquiryDuty(tx: Tx, id: string, actorId: string, status: 'COMPLETED' | 'CANCELLED') {
  const duty = await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'PURCHASING_INQUIRY', sourceId: id, status: 'OPEN' } });
  if (!duty) return;
  const now = new Date();
  const changed = await tx.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN' }, data: { status, ...(status === 'COMPLETED' ? { respondedAt: now, respondedByUserId: actorId } : {}), structuredResultJson: asJson({ result: status }) } });
  if (!changed.count) return;
  await tx.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null }, data: { endedAt: now, endReason: status, changedByUserId: actorId } });
  const latest = await tx.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
  await tx.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: (latest._max.version || 0) + 1, eventCode: status, actorUserId: actorId, sourceVersion: duty.sourceVersion, envelopeVersion: 1, policyVersion: 1, beforeJson: asJson({ status: 'OPEN' }), afterJson: asJson({ status }) } });
}
export async function reassignPurchasingInquiryDuty(tx: Tx, id: string, actorId: string, ownerId: string) {
  const duty = await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'PURCHASING_INQUIRY', sourceId: id, status: 'OPEN' } });
  if (!duty || duty.currentAssigneeUserId === ownerId) return;
  const now = new Date();
  await tx.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null }, data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: actorId } });
  const previous = await tx.crossWorkspaceDutyAssignmentHistory.aggregate({ where: { dutyId: duty.id }, _max: { sequence: true } });
  await tx.crossWorkspaceDutyAssignmentHistory.create({ data: { dutyId: duty.id, sequence: (previous._max.sequence || 0) + 1, assignedUserId: ownerId, destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode, startedAt: now, changedByUserId: actorId, policyVersion: 1 } });
  await tx.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { currentAssigneeUserId: ownerId } });
  const latest = await tx.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
  await tx.crossWorkspaceDutyAuditVersion.create({ data: { dutyId: duty.id, version: (latest._max.version || 0) + 1, eventCode: 'REASSIGNED', actorUserId: actorId, sourceVersion: duty.sourceVersion, envelopeVersion: 1, policyVersion: 1, beforeJson: asJson({ currentAssigneeUserId: duty.currentAssigneeUserId }), afterJson: asJson({ currentAssigneeUserId: ownerId }) } });
}
const unavailable = async () => { throw new Error('DUTY_ACTION_AVAILABLE_IN_SOURCE_WORKSPACE'); };
const no = async () => false;
export const purchasingInquiryDutyAdapter = {
 sourceType: 'PURCHASING_INQUIRY', synchronize: unavailable, respond: unavailable, claim: unavailable,
 canClaim: no, claimRequiresReason: no, responseRequiresReason: no, canAccessSharedDecision: no,
 canReassign: no, reassign: unavailable, listEligibleAssignees: async () => [], reconcileAssignment: unavailable,
 loadInboxProjection: async (db, input) => {
   const doc = await db.purchasingDocument.findUnique({ where: { id: input.sourceId } });
   if (!doc || doc.kind !== 'INQUIRY') throw new Error('DUTY_SOURCE_CHANGED');
   const data = doc.data as Record<string, any>;
   return { title: `استعلام ${(displayText(data.stone) || 'سنگ')}`, description: [data.contractNumber ? `قرارداد ${data.contractNumber}` : null, data.quantity ? `مقدار: ${data.quantity} ${displayText(data.unit)}` : null].filter(Boolean).join(' · '), destinationHref: `/dashboard/purchasing/inquiries?document=${encodeURIComponent(doc.id)}`, sourceIsCurrent: doc.status === 'OPEN' };
 },
} satisfies CrossWorkspaceDutySourceAdapter;
