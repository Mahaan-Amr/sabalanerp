import type { Prisma } from "@prisma/client";
import { createHrHiringFinanceDuty } from "./crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter";

type AcceptedOfferDatabase = Prisma.TransactionClient;

export const reconcileAcceptedOfferFollowUp = async (
  database: AcceptedOfferDatabase,
  input: { applicationId: string; actorUserId: string; actorKind?: 'USER' | 'SYSTEM'; now?: Date },
) => {
  const now = input.now ?? new Date();
  const systemActor = input.actorKind === 'SYSTEM';
  const requirement = await database.hrCollateralRequirement.findFirst({
    where: { applicationId: input.applicationId, status: "ACTIVE" },
    orderBy: { version: "desc" },
  });
  if (!requirement) return { outcome: "NO_REQUIREMENT" as const };
  if (requirement.type === "NO_PRE_HIRE_COLLATERAL") {
    const heldEvidence = await database.hrCollateralItem.count({
      where: { applicationId: input.applicationId, receivedAt: { not: null }, returnConfirmedAt: null },
    });
    await database.hrJobApplication.update({
      where: { id: input.applicationId },
      data: { collateralClearance: heldEvidence ? "IN_PROGRESS" : "APPROVED" },
    });
    return { outcome: heldEvidence ? "RETURN_REQUIRED" as const : "EXPLICITLY_NOT_REQUIRED" as const };
  }

  let item = await database.hrCollateralItem.findFirst({
    where: { applicationId: input.applicationId, supersededBy: null },
    orderBy: { createdAt: "desc" },
  });
  let created = false;
  if (item) {
    const sameAmount = String(item.amountRials ?? '') === String(requirement.amountRials ?? '');
    const legacyMatch = !item.collateralRequirementId && item.type === requirement.type && sameAmount
      && item.note === requirement.candidateExplanation;
    if (legacyMatch) item = await database.hrCollateralItem.update({
      where: { id: item.id }, data: { collateralRequirementId: requirement.id },
    });
    const matchesActiveRequirement = item.collateralRequirementId === requirement.id;
    if (!matchesActiveRequirement) {
      if (item.receivedAt && !item.returnConfirmedAt) {
        await database.hrJobApplication.update({ where: { id: input.applicationId }, data: { collateralClearance: 'IN_PROGRESS' } });
        return { outcome: 'RETURN_REQUIRED' as const, itemId: item.id };
      }
      const prior = item;
      item = await database.hrCollateralItem.create({ data: {
        applicationId: input.applicationId, collateralRequirementId: requirement.id, supersedesItemId: prior.id, version: prior.version + 1,
        type: requirement.type, required: true, amountRials: requirement.amountRials,
        status: 'MISSING', note: requirement.candidateExplanation, recordedBy: requirement.proposedBy,
      } });
      created = true;
      const staleDuties = await database.crossWorkspaceDuty.findMany({
        where: { sourceType: 'HR_HIRING_FINANCE', sourceId: prior.id, status: 'OPEN' },
      });
      for (const duty of staleDuties) {
        await database.crossWorkspaceDuty.update({ where: { id: duty.id }, data: {
          status: 'CANCELLED', respondedAt: null, respondedByUserId: null,
          structuredResultJson: {
            reason: 'COLLATERAL_REQUIREMENT_SUPERSEDED',
            actorKind: systemActor ? 'SYSTEM' : 'USER',
            ...(systemActor ? { technicalActorUserId: input.actorUserId, source: 'ACCEPTED_OFFER_COLLATERAL_BACKFILL' } : {}),
          },
        } });
        await database.crossWorkspaceDutyAssignmentHistory.updateMany({
          where: { dutyId: duty.id, endedAt: null },
          data: { endedAt: now, endReason: 'SOURCE_CHANGED', changedByUserId: systemActor ? null : input.actorUserId },
        });
        const latestAudit = await database.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
        await database.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: (latestAudit._max.version || 0) + 1, eventCode: 'CANCELLED',
          actorUserId: systemActor ? null : input.actorUserId, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion,
          policyVersion: 1, reason: 'COLLATERAL_REQUIREMENT_SUPERSEDED', afterJson: {
            status: 'CANCELLED', actorKind: systemActor ? 'SYSTEM' : 'USER',
            ...(systemActor ? { technicalActorUserId: input.actorUserId, source: 'ACCEPTED_OFFER_COLLATERAL_BACKFILL' } : {}),
          },
        } });
      }
    }
  }
  if (!item) {
    item = await database.hrCollateralItem.create({
      data: {
        applicationId: input.applicationId, collateralRequirementId: requirement.id,
        type: requirement.type,
        required: true,
        amountRials: requirement.amountRials,
        status: "MISSING",
        note: requirement.candidateExplanation,
        recordedBy: requirement.proposedBy,
      },
    });
    created = true;
  }
  if (created) {
    await database.hrHiringAudit.create({
      data: {
        applicationId: input.applicationId,
        actorUserId: input.actorKind === 'SYSTEM' ? null : input.actorUserId,
        actorKind: input.actorKind ?? "USER",
        eventType: "ACCEPTED_OFFER_COLLATERAL_FOLLOW_UP_CREATED",
        payloadJson: { collateralItemId: item.id, requirementVersion: requirement.version,
          ...(input.actorKind === 'SYSTEM' ? { migrationTechnicalActorUserId: input.actorUserId } : {}) },
      },
    });
  }

  if (item.status === "VERIFIED" || item.status === "NOT_APPLICABLE") {
    await database.hrJobApplication.update({
      where: { id: input.applicationId }, data: { collateralClearance: "APPROVED" },
    });
  } else {
    await database.hrJobApplication.update({
      where: { id: input.applicationId }, data: { collateralClearance: "IN_PROGRESS" },
    });
    if (item.status === "MISSING") {
      await createHrHiringFinanceDuty(database, {
        collateralItemId: item.id,
        actionCode: "HIRING_COLLATERAL_RECORD_RECEIPT",
        actorUserId: input.actorUserId,
        now,
      });
    } else if (item.status === "RECEIVED") {
      await createHrHiringFinanceDuty(database, {
        collateralItemId: item.id,
        actionCode: "HIRING_COLLATERAL_VERIFY_RECEIPT",
        actorUserId: input.actorUserId,
        now,
      });
    }
  }

  return { outcome: created ? "CREATED" as const : "EXISTING" as const, itemId: item.id };
};
