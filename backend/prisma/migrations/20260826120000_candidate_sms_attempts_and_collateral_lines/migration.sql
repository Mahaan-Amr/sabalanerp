-- Keep each SMS.ir submission as immutable delivery evidence. Legacy columns remain
-- during the compatibility window and are backfilled without claiming delivery when
-- the old schema did not persist a provider message id.
CREATE TABLE "hr_candidate_sms_attempts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerMessageId" TEXT,
    "providerDeliveryState" TEXT NOT NULL DEFAULT 'PENDING',
    "providerDeliveryAt" TIMESTAMP(3),
    "providerLastCheckedAt" TIMESTAMP(3),
    "immediateError" TEXT,
    "initiatedByUserId" TEXT,
    "initiatedByKind" TEXT NOT NULL DEFAULT 'USER',
    "retryOfAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_candidate_sms_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_candidate_sms_attempts_purpose_referenceId_attemptNumber_key"
  ON "hr_candidate_sms_attempts"("purpose", "referenceId", "attemptNumber");
CREATE INDEX "hr_candidate_sms_attempts_applicationId_purpose_createdAt_idx"
  ON "hr_candidate_sms_attempts"("applicationId", "purpose", "createdAt");
CREATE INDEX "hr_candidate_sms_attempts_providerMessageId_idx"
  ON "hr_candidate_sms_attempts"("providerMessageId");
ALTER TABLE "hr_candidate_sms_attempts"
  ADD CONSTRAINT "hr_candidate_sms_attempts_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "hr_candidate_sms_attempts" (
  "id", "applicationId", "purpose", "referenceId", "attemptNumber",
  "providerMessageId", "providerDeliveryState", "providerDeliveryAt",
  "providerLastCheckedAt", "initiatedByUserId", "initiatedByKind", "createdAt", "updatedAt"
)
SELECT
  'legacy-invitation-' || "id", "applicationId", 'INVITATION', "id", 1,
  "providerMessageId", COALESCE("providerDeliveryState", 'UNKNOWN'), "providerDeliveryAt",
  "providerLastCheckedAt", "createdBy", 'USER', "createdAt", "createdAt"
FROM "hr_candidate_invitations"
WHERE "providerMessageId" IS NOT NULL OR "providerDeliveryState" IS NOT NULL;

INSERT INTO "hr_candidate_sms_attempts" (
  "id", "applicationId", "purpose", "referenceId", "attemptNumber",
  "providerDeliveryState", "immediateError", "initiatedByUserId", "initiatedByKind", "createdAt", "updatedAt"
)
SELECT
  'legacy-correction-' || "id", "applicationId", 'CORRECTION', "id", 1,
  CASE WHEN "correctionNotificationStatus" = 'FAILED' THEN 'FAILED' ELSE 'UNKNOWN' END,
  "correctionNotificationError", "returnedBy", 'USER',
  COALESCE("correctionNotifiedAt", "returnedAt", "createdAt"), COALESCE("correctionNotifiedAt", "returnedAt", "createdAt")
FROM "hr_application_form_revisions"
WHERE "correctionNotificationStatus" IS NOT NULL;

INSERT INTO "hr_candidate_sms_attempts" (
  "id", "applicationId", "purpose", "referenceId", "attemptNumber",
  "providerDeliveryState", "immediateError", "initiatedByUserId", "initiatedByKind", "createdAt", "updatedAt"
)
SELECT
  'legacy-offer-' || "id", "applicationId", 'OFFER', "id", 1,
  CASE WHEN "candidateNotificationStatus" = 'FAILED' THEN 'FAILED' ELSE 'UNKNOWN' END,
  "candidateNotificationError", "payrollVerifiedBy", 'USER',
  COALESCE("candidateNotifiedAt", "payrollVerifiedAt", "createdAt"), COALESCE("candidateNotifiedAt", "payrollVerifiedAt", "createdAt")
FROM "hr_compensation_snapshots"
WHERE "candidateNotificationStatus" IS NOT NULL;

-- A requirement is the versioned bundle; each ordered line is independently fulfilled.
CREATE TABLE "hr_collateral_requirement_lines" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amountRials" DECIMAL(18,0),
    "customTitle" TEXT,
    "candidateExplanation" TEXT,
    CONSTRAINT "hr_collateral_requirement_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_collateral_requirement_lines_requirementId_lineKey_key"
  ON "hr_collateral_requirement_lines"("requirementId", "lineKey");
CREATE UNIQUE INDEX "hr_collateral_requirement_lines_requirementId_sortOrder_key"
  ON "hr_collateral_requirement_lines"("requirementId", "sortOrder");
CREATE INDEX "hr_collateral_requirement_lines_requirementId_sortOrder_idx"
  ON "hr_collateral_requirement_lines"("requirementId", "sortOrder");
ALTER TABLE "hr_collateral_requirement_lines"
  ADD CONSTRAINT "hr_collateral_requirement_lines_requirementId_fkey"
  FOREIGN KEY ("requirementId") REFERENCES "hr_collateral_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "hr_collateral_requirement_lines" (
  "id", "requirementId", "lineKey", "sortOrder", "type", "amountRials", "customTitle", "candidateExplanation"
)
SELECT
  'legacy-line-' || "id", "id", 'legacy', 0, "type", "amountRials",
  CASE WHEN "type" = 'OTHER' THEN COALESCE(NULLIF(BTRIM("obligation"), ''), 'سایر وثیقه') ELSE NULL END,
  "candidateExplanation"
FROM "hr_collateral_requirements"
WHERE "type" <> 'NO_PRE_HIRE_COLLATERAL';

-- Historical single-row requirements may not satisfy today's stricter amount rule.
-- Preserve them as evidence while enforcing the rule for every newly written line.
ALTER TABLE "hr_collateral_requirement_lines"
  ADD CONSTRAINT "hr_collateral_requirement_lines_amount_check" CHECK (
    ("type" IN ('PROMISSORY_NOTE', 'CHEQUE') AND "amountRials" > 0)
    OR ("type" IN ('GUARANTEE', 'UNDERTAKING') AND ("amountRials" IS NULL OR "amountRials" > 0))
    OR ("type" = 'OTHER' AND NULLIF(BTRIM("customTitle"), '') IS NOT NULL AND ("amountRials" IS NULL OR "amountRials" > 0))
  ) NOT VALID;

ALTER TABLE "hr_collateral_items" ADD COLUMN "collateralRequirementLineId" TEXT;
CREATE INDEX "hr_collateral_items_collateralRequirementLineId_idx"
  ON "hr_collateral_items"("collateralRequirementLineId");
ALTER TABLE "hr_collateral_items"
  ADD CONSTRAINT "hr_collateral_items_collateralRequirementLineId_fkey"
  FOREIGN KEY ("collateralRequirementLineId") REFERENCES "hr_collateral_requirement_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "hr_collateral_items" item
SET "collateralRequirementLineId" = line."id"
FROM "hr_collateral_requirement_lines" line
WHERE item."collateralRequirementId" = line."requirementId"
  AND line."lineKey" = 'legacy';
