import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';

export const PARTNER_PRICING_DUTY_DEFINITIONS = {
  PARTNER_PRICE_REVIEW: {
    sourceActionCode: 'PARTNER_PRICE_REVIEW', envelopeCode: 'PARTNER_PRICE_REVIEW', envelopeVersion: 1,
    destinationWorkspaceCode: 'SALES', accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: [] as string[],
    allowedEvidence: [] as string[], responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
} as const;

const definition = PARTNER_PRICING_DUTY_DEFINITIONS.PARTNER_PRICE_REVIEW;
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const nextAuditVersion = async (database: any, dutyId: string) =>
  ((await database.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId }, _max: { version: true } }))._max.version || 0) + 1;

const upsertEnvelope = (database: any, actorUserId: string) => database.crossWorkspaceDutyEnvelope.upsert({
  where: { code_version: { code: definition.envelopeCode, version: definition.envelopeVersion } },
  update: { destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationFeatureCode: 'PARTNER_PRICE_RESPONSE',
    allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes], responseSchemaJson: asJson(definition.responseSchema), isActive: true },
  create: { code: definition.envelopeCode, version: definition.envelopeVersion,
    destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationFeatureCode: 'PARTNER_PRICE_RESPONSE',
    allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes], responseSchemaJson: asJson(definition.responseSchema),
    isActive: true, createdByUserId: actorUserId },
});

export const syncPartnerPricingDutyDefinitions = (database: any, actorUserId = 'SYSTEM') =>
  upsertEnvelope(database, actorUserId).then((envelope: unknown) => [envelope]);

const closeOpenDuties = async (database: any, input: { inquiryId: string; actorUserId: string;
  status: 'COMPLETED' | 'CANCELLED' | 'WAIVED'; eventCode: 'COMPLETED' | 'CANCELLED' | 'WAIVED'; reason: string; now: Date }) => {
  const duties = await database.crossWorkspaceDuty.findMany({ where: {
    sourceType: 'PARTNER_PRICING', sourceId: input.inquiryId, status: 'OPEN',
  } });
  for (const duty of duties) {
    const changed = await database.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN' }, data: {
      status: input.status, respondedAt: input.now, respondedByUserId: input.actorUserId,
      structuredResultJson: asJson({ result: input.eventCode }),
    } });
    if (!changed.count) continue;
    await database.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null }, data: {
      endedAt: input.now, endReason: input.status,
      changedByUserId: input.actorUserId,
    } });
    await database.crossWorkspaceDutyAuditVersion.create({ data: {
      dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: input.eventCode,
      actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
      policyVersion: 1, reason: input.reason, beforeJson: asJson({ status: 'OPEN' }), afterJson: asJson({ status: input.status }),
    } });
  }
  return duties;
};

export const createPartnerPricingDuty = async (database: any, input: {
  inquiryId: string; actorUserId: string; inquiryRevision: number; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const inquiry = await database.partnerInquiry.findUniqueOrThrow({ where: { id: input.inquiryId }, include: {
    case: { select: { caseNumber: true } },
    assignments: { orderBy: { revision: 'desc' }, take: 1, select: { responderId: true } },
  } });
  if (!inquiry.caseId || !inquiry.case || inquiry.revision !== input.inquiryRevision || !inquiry.assignments[0]) {
    throw new Error('DUTY_SOURCE_NOT_ACTIONABLE');
  }
  await upsertEnvelope(database, input.actorUserId);
  const predecessors = await closeOpenDuties(database, { inquiryId: inquiry.id, actorUserId: input.actorUserId,
    status: 'WAIVED', eventCode: 'WAIVED', reason: 'بسته قیمت جدید جایگزین بسته قبلی شد', now });
  const stableKey = `PARTNER_PRICING:${inquiry.id}:${input.inquiryRevision}`;
  const predecessor = predecessors.sort((left: any, right: any) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const duty = await database.crossWorkspaceDuty.upsert({ where: { stableKey }, update: {}, create: {
    stableKey, sourceType: 'PARTNER_PRICING', sourceId: inquiry.id, sourceActionCode: definition.sourceActionCode,
    sourceVersion: input.inquiryRevision, envelopeCode: definition.envelopeCode, envelopeVersion: definition.envelopeVersion,
    destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode,
    currentAssigneeUserId: inquiry.assignments[0].responderId, sourceActorUserId: input.actorUserId,
    dueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), ...(predecessor ? { predecessorDutyId: predecessor.id } : {}),
    createdByUserId: input.actorUserId,
  } });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({ where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } },
    update: {}, create: { dutyId: duty.id, sequence: 1, assignedUserId: inquiry.assignments[0].responderId,
      destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode,
      startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1 } });
  await database.crossWorkspaceDutyAuditVersion.upsert({ where: { dutyId_version: { dutyId: duty.id, version: 1 } },
    update: {}, create: { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: input.actorUserId,
      sourceVersion: input.inquiryRevision, envelopeVersion: definition.envelopeVersion, policyVersion: 1,
      afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: inquiry.assignments[0].responderId }) } });
  return duty;
};

export const reconcilePartnerPricingDuty = async (database: any, input: {
  inquiryId: string; actorUserId: string; cancelled?: boolean; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const pending = await database.partnerInquiryRow.count({ where: { inquiryId: input.inquiryId, outcome: 'PENDING' } });
  if (pending && !input.cancelled) return null;
  return closeOpenDuties(database, { inquiryId: input.inquiryId, actorUserId: input.actorUserId,
    status: input.cancelled ? 'CANCELLED' : 'COMPLETED', eventCode: input.cancelled ? 'CANCELLED' : 'COMPLETED',
    reason: input.cancelled ? 'پرونده قیمت‌گذاری لغو شد' : 'همه ردیف‌های بسته قیمت تعیین تکلیف شد', now });
};

export const reassignPartnerPricingDuty = async (database: any, input: {
  inquiryId: string; responderId: string; actorUserId: string; reason: string; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findFirst({ where: {
    sourceType: 'PARTNER_PRICING', sourceId: input.inquiryId, status: 'OPEN',
  }, orderBy: { createdAt: 'desc' } });
  if (!duty || duty.currentAssigneeUserId === input.responderId) return duty;
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId: duty.id, endedAt: null }, data: {
    endedAt: now, endReason: 'REASSIGNED', changedByUserId: input.actorUserId,
  } });
  const aggregate = await database.crossWorkspaceDutyAssignmentHistory.aggregate({ where: { dutyId: duty.id }, _max: { sequence: true } });
  await database.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id, sequence: (aggregate._max.sequence || 0) + 1, assignedUserId: input.responderId,
    destinationWorkspaceCode: definition.destinationWorkspaceCode, destinationQueueCode: definition.sourceActionCode,
    startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1,
  } });
  await database.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { currentAssigneeUserId: input.responderId } });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id, version: await nextAuditVersion(database, duty.id), eventCode: 'REASSIGNED',
    actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
    policyVersion: 1, reason: input.reason, beforeJson: asJson({ currentAssigneeUserId: duty.currentAssigneeUserId }),
    afterJson: asJson({ currentAssigneeUserId: input.responderId }),
  } });
  return duty;
};

const loadInboxProjection: CrossWorkspaceDutySourceAdapter['loadInboxProjection'] = async (database, input) => {
  const inquiry = await database.partnerInquiry.findUnique({ where: { id: input.sourceId }, include: {
    case: { select: { caseNumber: true } }, rows: { where: { outcome: 'PENDING' }, select: { id: true } },
  } });
  if (!inquiry?.caseId || !inquiry.case) throw new Error('DUTY_SOURCE_CHANGED');
  return { title: `بررسی قیمت پرونده ${inquiry.case.caseNumber}`,
    description: `${inquiry.rows.length.toLocaleString('fa-IR')} ردیف فنی در انتظار قیمت سبلان`,
    destinationHref: `/dashboard/sales/partner-inquiries?inquiryId=${encodeURIComponent(inquiry.id)}`,
    sourceIsCurrent: inquiry.rows.length > 0 };
};

const synchronize: CrossWorkspaceDutySourceAdapter['synchronize'] = async (database, input) => {
  const inquiry = await database.partnerInquiry.findUniqueOrThrow({ where: { id: input.sourceId }, select: { revision: true } });
  return createPartnerPricingDuty(database, { inquiryId: input.sourceId, actorUserId: input.actorUserId,
    inquiryRevision: inquiry.revision, now: input.now });
};
const unavailable = async () => { throw new Error('DUTY_ACTION_AVAILABLE_IN_SOURCE_WORKSPACE'); };
const alwaysFalse = async () => false;

export const partnerPricingDutyAdapter = {
  sourceType: 'PARTNER_PRICING', synchronize, respond: unavailable, claim: unavailable,
  canClaim: alwaysFalse, claimRequiresReason: alwaysFalse, responseRequiresReason: alwaysFalse,
  canAccessSharedDecision: alwaysFalse, canReassign: alwaysFalse, reassign: unavailable,
  listEligibleAssignees: async () => [], reconcileAssignment: unavailable, loadInboxProjection,
} satisfies CrossWorkspaceDutySourceAdapter;
