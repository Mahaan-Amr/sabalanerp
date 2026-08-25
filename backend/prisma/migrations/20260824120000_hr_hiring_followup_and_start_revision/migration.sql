ALTER TABLE "hr_company_evaluation_occurrences"
  ADD COLUMN "scorePolicy" TEXT NOT NULL DEFAULT 'OPTIONAL',
  ADD COLUMN "evaluatorPersonnelId" TEXT,
  ADD COLUMN "externalProviderName" TEXT,
  ADD COLUMN "externalProviderType" TEXT,
  ADD COLUMN "externalProviderPhone" TEXT,
  ADD COLUMN "externalProviderNote" TEXT,
  ADD COLUMN "plannedAt" TIMESTAMP(3),
  ADD COLUMN "reportDueAt" TIMESTAMP(3),
  ADD COLUMN "resultScore" INTEGER;

ALTER TABLE "hr_company_evaluation_occurrences"
  ADD CONSTRAINT "hr_company_evaluation_score_check"
  CHECK ("resultScore" IS NULL OR "resultScore" BETWEEN 1 AND 5);

ALTER TABLE "hr_company_evaluation_occurrences"
  ADD CONSTRAINT "hr_company_evaluation_evaluator_fkey"
  FOREIGN KEY ("evaluatorPersonnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "hr_company_evaluation_assignment_history" (
  "id" TEXT NOT NULL,
  "occurrenceId" TEXT NOT NULL,
  "evaluatorPersonnelId" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "hr_company_evaluation_assignment_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_company_evaluation_assignment_history_occurrence_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "hr_company_evaluation_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hr_company_evaluation_assignment_history_personnel_fkey" FOREIGN KEY ("evaluatorPersonnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "hr_company_evaluation_assignment_history_occurrence_idx" ON "hr_company_evaluation_assignment_history"("occurrenceId", "assignedAt");
CREATE INDEX "hr_company_evaluation_assignment_history_personnel_idx" ON "hr_company_evaluation_assignment_history"("evaluatorPersonnelId", "endedAt");

CREATE TABLE "hr_recruitment_evaluation_position_eligibilities" (
  "id" TEXT NOT NULL,
  "evaluationType" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredByUserId" TEXT,
  "retiredAt" TIMESTAMP(3),
  CONSTRAINT "hr_recruitment_evaluation_position_eligibilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_recruitment_evaluation_position_eligibilities_position_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hr_recruitment_evaluation_position_eligibilities_key" ON "hr_recruitment_evaluation_position_eligibilities"("evaluationType", "positionId");
CREATE INDEX "hr_recruitment_evaluation_position_eligibilities_active_idx" ON "hr_recruitment_evaluation_position_eligibilities"("evaluationType", "isActive");

ALTER TABLE "hr_insurance_enrollments"
  ADD COLUMN "startRevisionReviewRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "hr_payroll_participations"
  ADD COLUMN "startRevisionReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "hr_planned_start_revisions" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "priorScheduledStartDate" TIMESTAMP(3) NOT NULL,
  "revisedScheduledStartDate" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "payrollDateSynchronized" BOOLEAN NOT NULL DEFAULT false,
  "payrollReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "contractCorrectionRequired" BOOLEAN NOT NULL DEFAULT false,
  "insuranceReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "revisedByUserId" TEXT NOT NULL,
  "revisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_planned_start_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_planned_start_revisions_application_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "hr_planned_start_revisions_application_idx" ON "hr_planned_start_revisions"("applicationId", "revisedAt");

-- Report-first logical reconciliation: preserve every historical duty while making
-- only the newest open contract version actionable per hiring application.
WITH ranked AS (
  SELECT duty."id", contract."applicationId",
    ROW_NUMBER() OVER (PARTITION BY contract."applicationId" ORDER BY contract."version" DESC, duty."createdAt" DESC) AS rank
  FROM "hr_duties" duty
  JOIN "hr_employment_contract_documents" contract ON contract."id" = duty."sourceId"
  WHERE duty."sourceType" = 'HR_HIRING_FINANCE'
    AND duty."sourceActionCode" = 'HIRING_CONTRACT_REVIEW'
    AND duty."status" = 'OPEN'
), superseded AS (
  SELECT "id" FROM ranked WHERE rank > 1
)
UPDATE "hr_duties" duty
SET "status" = 'CANCELLED', "respondedAt" = CURRENT_TIMESTAMP,
    "structuredResultJson" = '{"actionCode":"SUPERSEDED_BY_NEWER_CONTRACT_VERSION"}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
FROM superseded
WHERE duty."id" = superseded."id";

UPDATE "hr_duty_assignment_history" history
SET "endedAt" = CURRENT_TIMESTAMP, "endReason" = 'SOURCE_CHANGED'
WHERE history."endedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "hr_duties" duty
    WHERE duty."id" = history."dutyId"
      AND duty."status" = 'CANCELLED'
      AND duty."structuredResultJson"->>'actionCode' = 'SUPERSEDED_BY_NEWER_CONTRACT_VERSION'
  );

WITH cancelled AS (
  SELECT duty.*, COALESCE((SELECT MAX(audit."version") FROM "hr_duty_audit_versions" audit WHERE audit."dutyId" = duty."id"), 0) + 1 AS next_version
  FROM "hr_duties" duty
  WHERE duty."status" = 'CANCELLED'
    AND duty."structuredResultJson"->>'actionCode' = 'SUPERSEDED_BY_NEWER_CONTRACT_VERSION'
)
INSERT INTO "hr_duty_audit_versions" (
  "id", "dutyId", "version", "eventCode", "actorUserId", "sourceVersion", "envelopeVersion", "policyVersion", "afterJson", "reason", "createdAt"
)
SELECT 'hr-contract-duty-reconcile-' || md5(cancelled."id"), cancelled."id", cancelled.next_version,
  'CANCELLED', NULL, cancelled."sourceVersion", cancelled."envelopeVersion", 1,
  '{"status":"CANCELLED","reason":"SUPERSEDED_BY_NEWER_CONTRACT_VERSION"}'::jsonb,
  'SUPERSEDED_BY_NEWER_CONTRACT_VERSION', CURRENT_TIMESTAMP
FROM cancelled
ON CONFLICT ("dutyId", "version") DO NOTHING;

WITH permissions(code, display_name) AS (
  VALUES
    ('MANAGE_RECRUITMENT_EVALUATOR_SETTINGS', 'مدیریت تنظیمات ارزیابان جذب'),
    ('REVISE_PLANNED_EMPLOYMENT_START', 'اصلاح تاریخ برنامه‌ریزی‌شده شروع')
)
INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-action-' || md5(code), code, 'HUMAN_RESOURCES', 1, display_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permissions
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

WITH authority_actions(authority_code, feature_code, access_level) AS (
  VALUES
    ('HR_MANAGER', 'VIEW_COMPANY_EVALUATION_RESULTS', 'VIEW'::"HrAccessLevel"),
    ('HR_MANAGER', 'RECORD_COMPANY_EVALUATION_RESULT', 'EDIT'::"HrAccessLevel"),
    ('HR_MANAGER', 'MANAGE_RECRUITMENT_EVALUATOR_SETTINGS', 'ADMIN'::"HrAccessLevel"),
    ('HR_MANAGER', 'REVISE_PLANNED_EMPLOYMENT_START', 'EDIT'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'VIEW_COMPANY_EVALUATION_RESULTS', 'VIEW'::"HrAccessLevel"),
    ('HR_PROCESSOR', 'REVISE_PLANNED_EMPLOYMENT_START', 'EDIT'::"HrAccessLevel")
), legacy_holders AS (
  SELECT "userId", "authorityCode"::text AS authority_code, "effectiveFrom", "effectiveTo"
  FROM "hr_business_authority_grants"
  WHERE "status" = 'ACTIVE' AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
  UNION ALL
  SELECT "userId", "authority"::text, "createdAt", "expiresAt"
  FROM "hr_hiring_authorities"
  WHERE "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
), expanded AS (
  SELECT DISTINCT holder."userId", mapping.feature_code, mapping.access_level, holder."effectiveFrom", holder."effectiveTo"
  FROM legacy_holders holder
  JOIN authority_actions mapping ON mapping.authority_code = holder.authority_code
  WHERE NOT EXISTS (
    SELECT 1 FROM "hr_feature_access_grants" existing
    WHERE existing."userId" = holder."userId" AND existing."featureCode" = mapping.feature_code
  )
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'hr-hiring-followup-grant-' || md5("userId" || ':' || feature_code),
  'hr-hiring-followup:' || "userId" || ':' || feature_code,
  "userId", feature_code, access_level, 'ACTIVE'::"HrGrantStatus", MIN("effectiveFrom"),
  CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END,
  'Controlled HR hiring follow-up permission migration', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM expanded
GROUP BY "userId", feature_code, access_level
ON CONFLICT ("stableKey") DO NOTHING;
