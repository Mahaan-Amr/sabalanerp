import type { HrCollateralItem, Prisma } from '@prisma/client';
import { createHrHiringFinanceDuty } from './crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter';

type AcceptedOfferDatabase = Prisma.TransactionClient;

export const cancelStaleFinanceDuties = async (
  database: AcceptedOfferDatabase,
  itemIds: string[],
  input: { actorUserId: string; actorKind?: 'USER' | 'SYSTEM'; now: Date },
) => {
  if (!itemIds.length) return;
  const duties = await database.crossWorkspaceDuty.findMany({
    where: { sourceType: 'HR_HIRING_FINANCE', sourceId: { in: itemIds }, status: 'OPEN' },
  });
  for (const duty of duties) {
    const cancelled = await database.crossWorkspaceDuty.updateMany({ where: { id: duty.id, status: 'OPEN' }, data: {
      status: 'CANCELLED', respondedAt: null, respondedByUserId: null,
      structuredResultJson: {
        reason: 'COLLATERAL_REQUIREMENT_SUPERSEDED', actorKind: input.actorKind ?? 'USER',
        ...(input.actorKind === 'SYSTEM' ? { technicalActorUserId: input.actorUserId } : {}),
      },
    } });
    if (cancelled.count !== 1) continue;
    await database.crossWorkspaceDutyAssignmentHistory.updateMany({
      where: { dutyId: duty.id, endedAt: null },
      data: { endedAt: input.now, endReason: 'SOURCE_CHANGED', changedByUserId: input.actorKind === 'SYSTEM' ? null : input.actorUserId },
    });
    const latestAudit = await database.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
    await database.crossWorkspaceDutyAuditVersion.create({ data: {
      dutyId: duty.id, version: (latestAudit._max.version || 0) + 1, eventCode: 'CANCELLED',
      actorUserId: input.actorKind === 'SYSTEM' ? null : input.actorUserId,
      sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
      policyVersion: 1, reason: 'COLLATERAL_REQUIREMENT_SUPERSEDED',
      afterJson: {
        status: 'CANCELLED', actorKind: input.actorKind ?? 'USER',
        ...(input.actorKind === 'SYSTEM' ? { technicalActorUserId: input.actorUserId } : {}),
      },
    } });
  }
};

export const reconcileAcceptedOfferFollowUp = async (
  database: AcceptedOfferDatabase,
  input: { applicationId: string; actorUserId: string; actorKind?: 'USER' | 'SYSTEM'; now?: Date },
) => {
  const now = input.now ?? new Date();
  const requirement = await database.hrCollateralRequirement.findFirst({
    where: { applicationId: input.applicationId, status: 'ACTIVE' },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { version: 'desc' },
  });
  if (!requirement) return { outcome: 'NO_REQUIREMENT' as const };
  if (requirement.type === 'NO_PRE_HIRE_COLLATERAL') {
    const heldEvidence = await database.hrCollateralItem.count({
      where: { applicationId: input.applicationId, receivedAt: { not: null }, returnConfirmedAt: null },
    });
    await database.hrJobApplication.update({
      where: { id: input.applicationId },
      data: { collateralClearance: heldEvidence ? 'IN_PROGRESS' : 'APPROVED' },
    });
    return { outcome: heldEvidence ? 'RETURN_REQUIRED' as const : 'EXPLICITLY_NOT_REQUIRED' as const };
  }

  const heldFromPriorVersion = await database.hrCollateralItem.findFirst({
    where: {
      applicationId: input.applicationId,
      collateralRequirementId: { not: requirement.id },
      receivedAt: { not: null }, returnConfirmedAt: null,
    },
  });
  if (heldFromPriorVersion) {
    await database.hrJobApplication.update({ where: { id: input.applicationId }, data: { collateralClearance: 'IN_PROGRESS' } });
    return { outcome: 'RETURN_REQUIRED' as const, itemId: heldFromPriorVersion.id };
  }

  const staleItems = await database.hrCollateralItem.findMany({
    where: { applicationId: input.applicationId, collateralRequirementId: { not: requirement.id }, supersededBy: null },
    select: { id: true },
  });
  await cancelStaleFinanceDuties(database, staleItems.map(({ id }) => id), { ...input, now });

  const effectiveLines = requirement.lines.length ? requirement.lines : [{
    id: null, lineKey: 'legacy', sortOrder: 0, type: requirement.type,
    amountRials: requirement.amountRials, customTitle: null,
    candidateExplanation: requirement.candidateExplanation, requirementId: requirement.id,
  }];
  const items: HrCollateralItem[] = [];
  let createdAny = false;
  for (const line of effectiveLines) {
    let item = await database.hrCollateralItem.findFirst({
      where: line.id
        ? { applicationId: input.applicationId, collateralRequirementLineId: line.id, supersededBy: null }
        : { applicationId: input.applicationId, collateralRequirementId: requirement.id, collateralRequirementLineId: null, supersededBy: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!item && line.id) {
      const legacy = await database.hrCollateralItem.findFirst({
        where: { applicationId: input.applicationId, collateralRequirementId: requirement.id, collateralRequirementLineId: null, type: line.type },
        orderBy: { createdAt: 'desc' },
      });
      if (legacy && String(legacy.amountRials ?? '') === String(line.amountRials ?? '')) {
        item = await database.hrCollateralItem.update({ where: { id: legacy.id }, data: { collateralRequirementLineId: line.id } });
      }
    }
    if (!item) {
      const previous = await database.hrCollateralItem.findFirst({
        where: {
          applicationId: input.applicationId, supersededBy: null,
          collateralRequirementId: { not: requirement.id },
          ...(line.id
            ? { OR: [{ collateralRequirementLine: { lineKey: line.lineKey } }, { collateralRequirementLineId: null, type: line.type }] }
            : { type: line.type }),
        },
        orderBy: { createdAt: 'desc' },
      });
      item = await database.hrCollateralItem.create({ data: {
        applicationId: input.applicationId, collateralRequirementId: requirement.id,
        collateralRequirementLineId: line.id, type: line.type, required: true,
        amountRials: line.amountRials, status: 'MISSING',
        note: line.candidateExplanation || requirement.candidateExplanation,
        recordedBy: requirement.proposedBy,
        supersedesItemId: previous?.id,
        version: previous ? previous.version + 1 : 1,
      } });
      createdAny = true;
    }
    items.push(item);
  }

  if (createdAny) await database.hrHiringAudit.create({ data: {
    applicationId: input.applicationId,
    actorUserId: input.actorKind === 'SYSTEM' ? null : input.actorUserId,
    actorKind: input.actorKind ?? 'USER', eventType: 'ACCEPTED_OFFER_COLLATERAL_FOLLOW_UP_CREATED',
    payloadJson: {
      collateralItemIds: items.map(({ id }) => id), requirementVersion: requirement.version,
      lineCount: effectiveLines.length,
      ...(input.actorKind === 'SYSTEM' ? { migrationTechnicalActorUserId: input.actorUserId } : {}),
    },
  } });

  const complete = items.every((item) => ['VERIFIED', 'NOT_APPLICABLE'].includes(item.status));
  await database.hrJobApplication.update({
    where: { id: input.applicationId }, data: { collateralClearance: complete ? 'APPROVED' : 'IN_PROGRESS' },
  });
  if (!complete) for (const item of items) {
    if (item.status === 'MISSING') await createHrHiringFinanceDuty(database, {
      collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT', actorUserId: input.actorUserId, now,
    });
    else if (item.status === 'RECEIVED') await createHrHiringFinanceDuty(database, {
      collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_VERIFY_RECEIPT', actorUserId: input.actorUserId, now,
    });
  }
  return {
    outcome: createdAny ? 'CREATED' as const : 'EXISTING' as const,
    itemId: items[0]?.id, itemIds: items.map(({ id }) => id),
  };
};
