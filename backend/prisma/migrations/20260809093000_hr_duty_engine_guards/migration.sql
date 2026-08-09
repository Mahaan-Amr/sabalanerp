ALTER TABLE "hr_work_items"
  ADD COLUMN "dutyRoutingBlockedAt" TIMESTAMP(3),
  ADD COLUMN "dutyRoutingBlockReason" TEXT;

ALTER TABLE "hr_duties"
  ADD COLUMN "routingResponsibilityTypeCode" TEXT,
  ADD COLUMN "routingScopeType" TEXT,
  ADD COLUMN "routingScopeId" TEXT,
  ADD COLUMN "sourceActorUserId" TEXT;

UPDATE "hr_duties" AS duty
SET
  "routingResponsibilityTypeCode" = responsibility."responsibilityTypeCode",
  "routingScopeType" = responsibility."scopeType",
  "routingScopeId" = responsibility."scopeId"
FROM "hr_named_responsibilities" AS responsibility
WHERE duty."responsibilityId" = responsibility."id";

CREATE INDEX "hr_duties_routingResponsibilityTypeCode_routingScopeType_idx"
  ON "hr_duties"("routingResponsibilityTypeCode", "routingScopeType", "routingScopeId", "status");

CREATE INDEX "hr_work_items_dutyRoutingBlockedAt_idx"
  ON "hr_work_items"("dutyRoutingBlockedAt");
