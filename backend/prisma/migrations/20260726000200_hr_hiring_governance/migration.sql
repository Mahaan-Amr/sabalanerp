ALTER TYPE "HrHiringAuthorityType" ADD VALUE IF NOT EXISTS 'COMPANY_MANAGER';

CREATE TYPE "HrApplicationDisposition" AS ENUM ('INITIAL_REJECTED', 'RESERVE');
CREATE TYPE "HrChecklistItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'POSITIVE', 'NEGATIVE', 'CANCELLED', 'WAIVED');
CREATE TYPE "HrChecklistEvidencePolicy" AS ENUM ('NOTE_REQUIRED', 'FILE_REQUIRED', 'FILE_OPTIONAL', 'NO_FILE');
CREATE TYPE "HrHiringDecisionKind" AS ENUM ('HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL', 'COMPANY_APPROVAL');
CREATE TYPE "HrHiringDecisionOutcome" AS ENUM ('POSITIVE', 'NEGATIVE');
CREATE TYPE "HrAssessmentDecision" AS ENUM ('APPROVED', 'REPEAT_REQUIRED', 'RESERVE', 'REJECTED');
CREATE TYPE "HrReopeningStatus" AS ENUM ('AUTHORIZED', 'REOPENED', 'BLOCKED');

ALTER TABLE "hr_job_applications"
  ADD COLUMN "assessmentDecision" "HrAssessmentDecision",
  ADD COLUMN "assessmentDecisionBy" TEXT,
  ADD COLUMN "assessmentDecisionAt" TIMESTAMP(3),
  ADD COLUMN "assessmentDecisionReason" TEXT,
  ADD COLUMN "assessmentRepeatDueAt" TIMESTAMP(3),
  ADD COLUMN "disposition" "HrApplicationDisposition",
  ADD COLUMN "dispositionReason" TEXT,
  ADD COLUMN "dispositionBy" TEXT,
  ADD COLUMN "dispositionAt" TIMESTAMP(3),
  ADD COLUMN "preIdentityRequirementsFinalizedBy" TEXT,
  ADD COLUMN "preIdentityRequirementsFinalizedAt" TIMESTAMP(3),
  ADD COLUMN "preIdentityManagementApprovedBy" TEXT,
  ADD COLUMN "preIdentityManagementApprovedAt" TIMESTAMP(3),
  ADD COLUMN "preIdentityManagementApprovalNote" TEXT,
  ADD COLUMN "preIdentityReleasedBy" TEXT,
  ADD COLUMN "preIdentityReleasedAt" TIMESTAMP(3),
  ADD COLUMN "preIdentityGrandfatheredAt" TIMESTAMP(3),
  ADD COLUMN "preClosureStage" "HrApplicationStage";

ALTER TABLE "hr_candidate_invitations"
  ADD COLUMN "overlapExpiresAt" TIMESTAMP(3),
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerDeliveryState" TEXT,
  ADD COLUMN "providerDeliveryAt" TIMESTAMP(3),
  ADD COLUMN "providerLastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "accessConfirmedAt" TIMESTAMP(3);

ALTER TABLE "hr_compensation_snapshots"
  ADD COLUMN "obsoleteAt" TIMESTAMP(3),
  ADD COLUMN "obsoleteBy" TEXT,
  ADD COLUMN "obsoleteReason" TEXT;

CREATE TABLE "hr_recruitment_checklist_templates" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "scopeType" TEXT NOT NULL DEFAULT 'JOB',
  "scopeId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_recruitment_checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_recruitment_checklist_template_items" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "instructions" TEXT,
  "evidencePolicy" "HrChecklistEvidencePolicy" NOT NULL DEFAULT 'NOTE_REQUIRED',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "hr_recruitment_checklist_template_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_pre_identity_checklist_items" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "templateItemId" TEXT,
  "requirementKey" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "instructions" TEXT,
  "status" "HrChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
  "evidencePolicy" "HrChecklistEvidencePolicy" NOT NULL DEFAULT 'NOTE_REQUIRED',
  "dueAt" TIMESTAMP(3),
  "resultExplanation" TEXT,
  "resultSource" TEXT,
  "resultDate" TIMESTAMP(3),
  "managementResolution" TEXT,
  "managementResolutionReason" TEXT,
  "storageName" TEXT,
  "originalName" TEXT,
  "mimeType" TEXT,
  "size" INTEGER,
  "sha256" TEXT,
  "malwareScanStatus" TEXT,
  "recordedBy" TEXT,
  "recordedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_pre_identity_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_pre_identity_checklist_events" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_pre_identity_checklist_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_application_decisions" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "kind" "HrHiringDecisionKind" NOT NULL,
  "outcome" "HrHiringDecisionOutcome" NOT NULL,
  "explanation" TEXT,
  "changeReason" TEXT,
  "version" INTEGER NOT NULL,
  "decidedBy" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_application_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_application_reopenings" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "status" "HrReopeningStatus" NOT NULL,
  "companyAuthorizedBy" TEXT,
  "companyAuthorizedAt" TIMESTAMP(3),
  "companyReason" TEXT,
  "hrExecutedBy" TEXT,
  "hrExecutedAt" TIMESTAMP(3),
  "hrReason" TEXT,
  "candidateConsentMethod" TEXT,
  "candidateConsentedAt" TIMESTAMP(3),
  "candidateConsentNote" TEXT,
  "blockedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_application_reopenings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_collateral_requirements" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "amountRials" DECIMAL(18,0),
  "obligation" TEXT,
  "dueTiming" TEXT,
  "candidateExplanation" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "proposedBy" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedesId" TEXT,
  CONSTRAINT "hr_collateral_requirements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_recruitment_checklist_templates_name_version_key" ON "hr_recruitment_checklist_templates"("name", "version");
CREATE INDEX "hr_recruitment_checklist_templates_scopeType_scopeId_isActive_idx" ON "hr_recruitment_checklist_templates"("scopeType", "scopeId", "isActive");
CREATE INDEX "hr_recruitment_checklist_template_items_templateId_sortOrder_idx" ON "hr_recruitment_checklist_template_items"("templateId", "sortOrder");
CREATE UNIQUE INDEX "hr_pre_identity_checklist_items_applicationId_requirementKey_attempt_key" ON "hr_pre_identity_checklist_items"("applicationId", "requirementKey", "attempt");
CREATE INDEX "hr_pre_identity_checklist_items_applicationId_status_dueAt_idx" ON "hr_pre_identity_checklist_items"("applicationId", "status", "dueAt");
CREATE INDEX "hr_pre_identity_checklist_events_itemId_createdAt_idx" ON "hr_pre_identity_checklist_events"("itemId", "createdAt");
CREATE UNIQUE INDEX "hr_application_decisions_applicationId_kind_version_key" ON "hr_application_decisions"("applicationId", "kind", "version");
CREATE INDEX "hr_application_decisions_applicationId_kind_decidedAt_idx" ON "hr_application_decisions"("applicationId", "kind", "decidedAt");
CREATE INDEX "hr_application_reopenings_applicationId_status_createdAt_idx" ON "hr_application_reopenings"("applicationId", "status", "createdAt");
CREATE UNIQUE INDEX "hr_collateral_requirements_applicationId_version_key" ON "hr_collateral_requirements"("applicationId", "version");
CREATE INDEX "hr_collateral_requirements_applicationId_status_idx" ON "hr_collateral_requirements"("applicationId", "status");

ALTER TABLE "hr_recruitment_checklist_template_items" ADD CONSTRAINT "hr_recruitment_checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "hr_recruitment_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_pre_identity_checklist_items" ADD CONSTRAINT "hr_pre_identity_checklist_items_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_pre_identity_checklist_items" ADD CONSTRAINT "hr_pre_identity_checklist_items_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "hr_recruitment_checklist_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_pre_identity_checklist_events" ADD CONSTRAINT "hr_pre_identity_checklist_events_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "hr_pre_identity_checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_application_decisions" ADD CONSTRAINT "hr_application_decisions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_application_reopenings" ADD CONSTRAINT "hr_application_reopenings_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_collateral_requirements" ADD CONSTRAINT "hr_collateral_requirements_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing cases that have already entered or passed identity are grandfathered
-- without fabricating a business decision actor.
UPDATE "hr_job_applications"
SET "preIdentityGrandfatheredAt" = CURRENT_TIMESTAMP,
    "preIdentityRequirementsFinalizedAt" = CURRENT_TIMESTAMP,
    "preIdentityReleasedAt" = CURRENT_TIMESTAMP
WHERE "identityClearance" <> 'NOT_STARTED'
   OR "stage" IN ('ASSESSMENT', 'OFFER', 'CLOSED');

ALTER TABLE "hr_hiring_authorities" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "hr_hiring_authorities_authority_isActive_expiresAt_idx" ON "hr_hiring_authorities"("authority", "isActive", "expiresAt");

CREATE TABLE "hr_hiring_authority_audits" (
  "id" TEXT NOT NULL,
  "authorityId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_hiring_authority_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_hiring_authority_audits_authorityId_createdAt_idx" ON "hr_hiring_authority_audits"("authorityId", "createdAt");

ALTER TABLE "hr_pre_identity_checklist_items" ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3);
