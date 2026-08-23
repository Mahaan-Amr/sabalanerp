import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { reconcileAcceptedOfferFollowUp } from "../hrAcceptedOfferFollowUp";

process.env.DATABASE_URL ??=
  "postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public";
const rollback = new Error("ROLLBACK_ACCEPTED_OFFER_FOLLOW_UP_TEST");

test("accepted offer follow-up creates one Accounting collateral duty and safely replays", async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const actor = await tx.user.create({
          data: {
            email: `${suffix}@example.invalid`, username: suffix,
            password: "not-a-login-secret", firstName: "Offer", lastName: "Owner",
          },
        });
        const unit = await tx.hrOrganizationalUnit.create({
          data: { code: `UNIT-${suffix}`, name: suffix, type: "DEPARTMENT", createdBy: actor.id },
        });
        const job = await tx.hrJob.create({
          data: { code: `JOB-${suffix}`, title: suffix, createdBy: actor.id },
        });
        const position = await tx.hrPosition.create({
          data: {
            code: `POS-${suffix}`, title: suffix, capacity: 1,
            organizationalUnitId: unit.id, jobId: job.id, createdBy: actor.id,
          },
        });
        const candidate = await tx.hrCandidate.create({
          data: { firstName: "Accepted", lastName: "Candidate", mobile: `09${Date.now().toString().slice(-9)}` },
        });
        const application = await tx.hrJobApplication.create({
          data: { candidateId: candidate.id, positionId: position.id, createdBy: actor.id, acceptedOfferAt: new Date() },
        });
        const firstRequirement = await tx.hrCollateralRequirement.create({
          data: {
            applicationId: application.id, version: 1, type: "PROMISSORY_NOTE",
            amountRials: "20000000", candidateExplanation: "سفته الزامی", proposedBy: actor.id,
          },
        });

        const now = new Date("2026-08-23T08:00:00.000Z");
        const first = await reconcileAcceptedOfferFollowUp(tx, {
          applicationId: application.id, actorUserId: actor.id, now,
        });
        const replay = await reconcileAcceptedOfferFollowUp(tx, {
          applicationId: application.id, actorUserId: actor.id, now,
        });

        assert.equal(first.outcome, "CREATED");
        assert.equal(replay.outcome, "EXISTING");
        assert.equal(await tx.hrCollateralItem.count({ where: { applicationId: application.id } }), 1);
        assert.equal(
          (await tx.hrCollateralItem.findFirstOrThrow({ where: { applicationId: application.id } })).collateralRequirementId,
          firstRequirement.id,
        );
        assert.equal(await tx.crossWorkspaceDuty.count({
          where: { sourceType: "HR_HIRING_FINANCE", sourceActionCode: "HIRING_COLLATERAL_RECORD_RECEIPT" },
        }), 1);
        assert.equal(
          (await tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id } })).collateralClearance,
          "IN_PROGRESS",
        );

        await tx.hrCollateralRequirement.update({ where: { id: firstRequirement.id }, data: { status: 'SUPERSEDED' } });
        const secondRequirement = await tx.hrCollateralRequirement.create({ data: {
          applicationId: application.id, version: 2, type: firstRequirement.type,
          amountRials: firstRequirement.amountRials, candidateExplanation: firstRequirement.candidateExplanation,
          proposedBy: actor.id,
        } });
        const reconciled = await reconcileAcceptedOfferFollowUp(tx, {
          applicationId: application.id, actorUserId: actor.id, actorKind: 'SYSTEM', now,
        });
        assert.equal(reconciled.outcome, 'CREATED');
        assert.equal(
          (await tx.hrCollateralItem.findFirstOrThrow({
            where: { applicationId: application.id, supersededBy: null },
          })).collateralRequirementId,
          secondRequirement.id,
        );
        const cancelledDuty = await tx.crossWorkspaceDuty.findFirstOrThrow({
          where: { sourceType: 'HR_HIRING_FINANCE', sourceId: { not: reconciled.itemId }, status: 'CANCELLED' },
        });
        assert.equal(cancelledDuty.respondedByUserId, null);
        assert.equal(
          (await tx.crossWorkspaceDutyAssignmentHistory.findFirstOrThrow({ where: { dutyId: cancelledDuty.id } })).changedByUserId,
          null,
        );
        const cancellationAudit = await tx.crossWorkspaceDutyAuditVersion.findFirstOrThrow({
          where: { dutyId: cancelledDuty.id, eventCode: 'CANCELLED' },
        });
        assert.equal(cancellationAudit.actorUserId, null);
        assert.equal((cancellationAudit.afterJson as Record<string, unknown>).actorKind, 'SYSTEM');
        assert.equal((cancellationAudit.afterJson as Record<string, unknown>).technicalActorUserId, actor.id);
        throw rollback;
      }, { timeout: 120_000 }),
      (error: unknown) => error === rollback,
    );
  } finally {
    await prisma.$disconnect();
  }
});
