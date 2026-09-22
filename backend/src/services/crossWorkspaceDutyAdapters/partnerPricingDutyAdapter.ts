import { Prisma } from '@prisma/client';
import type { CrossWorkspaceDutySourceAdapter } from './types';

export const PARTNER_PRICING_DUTY_DEFINITIONS = {
  PARTNER_PRICE_REVIEW: {
    sourceActionCode: 'PARTNER_PRICE_REVIEW', envelopeCode: 'PARTNER_PRICE_REVIEW', envelopeVersion: 1,
    destinationWorkspaceCode: 'SALES', accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
    workspaceAdminOverrideDenied: false,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: [] as string[],
    allowedEvidence: [] as string[], responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  PARTNER_PRICE_RESULT: {
    sourceActionCode: 'PARTNER_PRICE_RESULT', envelopeCode: 'PARTNER_PRICE_RESULT', envelopeVersion: 1,
    destinationWorkspaceCode: 'SALES', accountabilityModel: 'INDIVIDUAL_EXECUTION' as const,
    workspaceAdminOverrideDenied: false,
    allowedFields: ['title', 'description', 'dueAt'] as const, allowedActionCodes: [] as string[],
    allowedEvidence: [] as string[], responseSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
} as const;

const reviewDefinition = PARTNER_PRICING_DUTY_DEFINITIONS.PARTNER_PRICE_REVIEW;
const resultDefinition = PARTNER_PRICING_DUTY_DEFINITIONS.PARTNER_PRICE_RESULT;
const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const nextAuditVersion = async (database: any, dutyId: string) =>
  ((await database.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId }, _max: { version: true } }))._max.version || 0) + 1;

const upsertEnvelope = (database: any, actorUserId: string,
  definition: typeof reviewDefinition | typeof resultDefinition) => database.crossWorkspaceDutyEnvelope.upsert({
  where: { code_version: { code: definition.envelopeCode, version: definition.envelopeVersion } },
  update: { destinationWorkspaceCode: definition.destinationWorkspaceCode,
    destinationFeatureCode: definition.sourceActionCode === 'PARTNER_PRICE_REVIEW' ? 'PARTNER_PRICE_RESPONSE' : 'PARTNER_CASE_CREATE',
    allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes], responseSchemaJson: asJson(definition.responseSchema), isActive: true },
  create: { code: definition.envelopeCode, version: definition.envelopeVersion,
    destinationWorkspaceCode: definition.destinationWorkspaceCode,
    destinationFeatureCode: definition.sourceActionCode === 'PARTNER_PRICE_REVIEW' ? 'PARTNER_PRICE_RESPONSE' : 'PARTNER_CASE_CREATE',
    allowedFieldsJson: [...definition.allowedFields], allowedEvidenceJson: [...definition.allowedEvidence],
    allowedActionCodesJson: [...definition.allowedActionCodes], responseSchemaJson: asJson(definition.responseSchema),
    isActive: true, createdByUserId: actorUserId },
});

export const syncPartnerPricingDutyDefinitions = (database: any, actorUserId = 'SYSTEM') =>
  Promise.all(Object.values(PARTNER_PRICING_DUTY_DEFINITIONS).map(definition =>
    upsertEnvelope(database, actorUserId, definition)));

const closeOpenDuties = async (database: any, input: { inquiryId: string; actorUserId: string;
  status: 'COMPLETED' | 'CANCELLED' | 'WAIVED'; eventCode: 'COMPLETED' | 'CANCELLED' | 'WAIVED'; reason: string; now: Date;
  sourceActionCode?: string }) => {
  const duties = await database.crossWorkspaceDuty.findMany({ where: {
    sourceType: 'PARTNER_PRICING', sourceId: input.inquiryId, status: 'OPEN',
    ...(input.sourceActionCode ? { sourceActionCode: input.sourceActionCode } : {}),
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
  await upsertEnvelope(database, input.actorUserId, reviewDefinition);
  const predecessors = await closeOpenDuties(database, { inquiryId: inquiry.id, actorUserId: input.actorUserId,
    status: 'WAIVED', eventCode: 'WAIVED', reason: 'بسته قیمت جدید جایگزین بسته قبلی شد', now,
    sourceActionCode: reviewDefinition.sourceActionCode });
  const stableKey = `PARTNER_PRICING:${inquiry.id}:${input.inquiryRevision}`;
  const predecessor = predecessors.sort((left: any, right: any) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  const duty = await database.crossWorkspaceDuty.upsert({ where: { stableKey }, update: {}, create: {
    stableKey, sourceType: 'PARTNER_PRICING', sourceId: inquiry.id, sourceActionCode: reviewDefinition.sourceActionCode,
    sourceVersion: input.inquiryRevision, envelopeCode: reviewDefinition.envelopeCode, envelopeVersion: reviewDefinition.envelopeVersion,
    destinationWorkspaceCode: reviewDefinition.destinationWorkspaceCode, destinationQueueCode: reviewDefinition.sourceActionCode,
    currentAssigneeUserId: inquiry.assignments[0].responderId, sourceActorUserId: input.actorUserId,
    dueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), ...(predecessor ? { predecessorDutyId: predecessor.id } : {}),
    createdByUserId: input.actorUserId,
  } });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({ where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } },
    update: {}, create: { dutyId: duty.id, sequence: 1, assignedUserId: inquiry.assignments[0].responderId,
      destinationWorkspaceCode: reviewDefinition.destinationWorkspaceCode, destinationQueueCode: reviewDefinition.sourceActionCode,
      startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1 } });
  await database.crossWorkspaceDutyAuditVersion.upsert({ where: { dutyId_version: { dutyId: duty.id, version: 1 } },
    update: {}, create: { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: input.actorUserId,
      sourceVersion: input.inquiryRevision, envelopeVersion: reviewDefinition.envelopeVersion, policyVersion: 1,
      afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: inquiry.assignments[0].responderId }) } });
  return duty;
};

export const createPartnerPricingResultDuty = async (database: any, input: {
  inquiryId: string; actorUserId: string; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const inquiry = await database.partnerInquiry.findUniqueOrThrow({ where: { id: input.inquiryId }, include: {
    case: { select: { caseNumber: true } }, profile: { select: { userId: true } },
    rows: { where: { successor: null }, select: { outcome: true } },
  } });
  if (!inquiry.caseId || !inquiry.case || !inquiry.rows.length || inquiry.rows.some((row: any) => row.outcome === 'PENDING')) {
    return null;
  }
  await upsertEnvelope(database, input.actorUserId, resultDefinition);
  const stableKey = `PARTNER_PRICING_RESULT:${inquiry.id}:${inquiry.revision}`;
  const duty = await database.crossWorkspaceDuty.upsert({ where: { stableKey }, update: {}, create: {
    stableKey, sourceType: 'PARTNER_PRICING', sourceId: inquiry.id, sourceActionCode: resultDefinition.sourceActionCode,
    sourceVersion: inquiry.revision, envelopeCode: resultDefinition.envelopeCode, envelopeVersion: resultDefinition.envelopeVersion,
    destinationWorkspaceCode: resultDefinition.destinationWorkspaceCode, destinationQueueCode: resultDefinition.sourceActionCode,
    currentAssigneeUserId: inquiry.profile.userId, sourceActorUserId: input.actorUserId,
    dueAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), createdByUserId: input.actorUserId,
  } });
  await database.crossWorkspaceDutyAssignmentHistory.upsert({ where: { dutyId_sequence: { dutyId: duty.id, sequence: 1 } },
    update: {}, create: { dutyId: duty.id, sequence: 1, assignedUserId: inquiry.profile.userId,
      destinationWorkspaceCode: resultDefinition.destinationWorkspaceCode, destinationQueueCode: resultDefinition.sourceActionCode,
      startedAt: now, changedByUserId: input.actorUserId, policyVersion: 1 } });
  await database.crossWorkspaceDutyAuditVersion.upsert({ where: { dutyId_version: { dutyId: duty.id, version: 1 } },
    update: {}, create: { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: input.actorUserId,
      sourceVersion: inquiry.revision, envelopeVersion: resultDefinition.envelopeVersion, policyVersion: 1,
      afterJson: asJson({ status: 'OPEN', currentAssigneeUserId: inquiry.profile.userId }) } });
  return duty;
};

export const reconcilePartnerPricingDuty = async (database: any, input: {
  inquiryId: string; actorUserId: string; cancelled?: boolean; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const pending = await database.partnerInquiryRow.count({ where: {
    inquiryId: input.inquiryId, successor: null, outcome: 'PENDING',
  } });
  if (pending && !input.cancelled) return null;
  const closed = await closeOpenDuties(database, { inquiryId: input.inquiryId, actorUserId: input.actorUserId,
    status: input.cancelled ? 'CANCELLED' : 'COMPLETED', eventCode: input.cancelled ? 'CANCELLED' : 'COMPLETED',
    reason: input.cancelled ? 'پرونده قیمت‌گذاری لغو شد' : 'همه ردیف‌های بسته قیمت تعیین تکلیف شد', now,
    sourceActionCode: reviewDefinition.sourceActionCode });
  if (!input.cancelled) await createPartnerPricingResultDuty(database, { inquiryId: input.inquiryId,
    actorUserId: input.actorUserId, now });
  return closed;
};

export const completePartnerPricingResultDutiesForCase = async (database: any, input: {
  caseId: string; actorUserId: string; now?: Date;
}) => {
  const now = input.now ?? new Date();
  const inquiries = await database.partnerInquiry.findMany({ where: { caseId: input.caseId }, select: { id: true } });
  for (const inquiry of inquiries) await closeOpenDuties(database, { inquiryId: inquiry.id,
    actorUserId: input.actorUserId, status: 'COMPLETED', eventCode: 'COMPLETED',
    reason: 'فروشنده همکار قیمت‌های سبلان را پذیرفت و ادامه ساخت پرونده را آغاز کرد', now,
    sourceActionCode: resultDefinition.sourceActionCode });
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
    destinationWorkspaceCode: reviewDefinition.destinationWorkspaceCode, destinationQueueCode: reviewDefinition.sourceActionCode,
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
    case: { select: { caseNumber: true } }, rows: { where: { successor: null }, select: { id: true, outcome: true } },
  } });
  if (!inquiry?.caseId || !inquiry.case) throw new Error('DUTY_SOURCE_CHANGED');
  if (input.sourceActionCode === resultDefinition.sourceActionCode) {
    const approved = inquiry.rows.filter((row: any) => row.outcome === 'APPROVED').length;
    const rejected = inquiry.rows.filter((row: any) => row.outcome === 'REJECTED').length;
    return { title: `نتیجه استعلام قیمت پرونده ${inquiry.case.caseNumber}`,
      description: rejected > 0
        ? `${rejected.toLocaleString('fa-IR')} ردیف نیازمند اصلاح و ${approved.toLocaleString('fa-IR')} ردیف قیمت‌گذاری‌شده`
        : `قیمت ${approved.toLocaleString('fa-IR')} ردیف از فروشنده سبلان دریافت شد`,
      destinationHref: `/dashboard/sales/contracts/create?caseId=${encodeURIComponent(inquiry.caseId)}`,
      sourceIsCurrent: inquiry.revision === input.sourceVersion && inquiry.rows.every((row: any) => row.outcome !== 'PENDING') };
  }
  const pending = inquiry.rows.filter((row: any) => row.outcome === 'PENDING');
  return { title: `بررسی قیمت پرونده ${inquiry.case.caseNumber}`,
    description: `${pending.length.toLocaleString('fa-IR')} ردیف فنی در انتظار قیمت سبلان`,
    destinationHref: `/dashboard/sales/partner-inquiries?inquiryId=${encodeURIComponent(inquiry.id)}`,
    sourceIsCurrent: pending.length > 0 };
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
