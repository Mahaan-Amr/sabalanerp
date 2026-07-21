CREATE TYPE "HrApplicationStage" AS ENUM ('RECEIVED', 'SCREENING', 'ASSESSMENT', 'OFFER', 'CLOSED');
CREATE TYPE "HrApplicationOutcome" AS ENUM ('HIRED', 'REJECTED', 'WITHDRAWN', 'REQUEST_CANCELLED');
CREATE TYPE "HrFormRevisionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED');
CREATE TYPE "HrEvidenceStatus" AS ENUM ('MISSING', 'RECEIVED', 'UNREADABLE', 'MISMATCH', 'VERIFIED', 'NOT_APPLICABLE');
CREATE TYPE "HrInspectionSource" AS ENUM ('ORIGINAL_SEEN', 'COPY_RECEIVED');
CREATE TYPE "HrHiringAuthorityType" AS ENUM ('HR_PROCESSOR', 'HR_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER', 'HIRING_MANAGER');
CREATE TYPE "HrClearanceStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'APPROVED', 'REJECTED');
CREATE TYPE "HrInsuranceEnrollmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ACTIVE', 'EXEMPT');
CREATE TYPE "HrOnboardingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'WAIVED');
CREATE TYPE "HrAssessmentType" AS ENUM ('DISC', 'BIG_FIVE', 'EQ', 'OTHER');

ALTER TABLE "hr_employment_relationships" ADD COLUMN "hiringApplicationId" TEXT;

CREATE TABLE "hr_candidates" (
  "id" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL, "mobile" TEXT NOT NULL,
  "nationalCode" TEXT, "foreignIdentityType" TEXT, "foreignIdentityNumber" TEXT, "postalCode" TEXT, "hasSocialSecurityHistory" BOOLEAN, "profileJson" JSONB,
  "talentBankSearchable" BOOLEAN NOT NULL DEFAULT true, "privacyNoticeAcceptedAt" TIMESTAMP(3),
  "linkedPersonnelId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "hr_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_job_applications" (
  "id" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "positionId" TEXT NOT NULL,
  "stage" "HrApplicationStage" NOT NULL DEFAULT 'RECEIVED', "outcome" "HrApplicationOutcome", "outcomeReason" TEXT,
  "currentRevisionNumber" INTEGER NOT NULL DEFAULT 0,
  "identityClearance" "HrClearanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "collateralClearance" "HrClearanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "contractClearance" "HrClearanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "compensationClearance" "HrClearanceStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "acceptedOfferAt" TIMESTAMP(3), "convertedAt" TIMESTAMP(3), "scheduledStartDate" TIMESTAMP(3), "activatedAt" TIMESTAMP(3),
  "postalVerificationDeferred" BOOLEAN NOT NULL DEFAULT true, "collateralTemplateId" TEXT, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_job_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_candidate_invitations" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "otpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "lastVerifiedAt" TIMESTAMP(3),
  "verificationCount" INTEGER NOT NULL DEFAULT 0, "failedAttempts" INTEGER NOT NULL DEFAULT 0, "blockedUntil" TIMESTAMP(3), "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "hr_candidate_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_application_form_revisions" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "revisionNumber" INTEGER NOT NULL,
  "status" "HrFormRevisionStatus" NOT NULL DEFAULT 'DRAFT', "dataJson" JSONB NOT NULL,
  "correctionFieldsJson" JSONB, "correctionReason" TEXT, "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
  "declarationFullName" TEXT, "submittedAt" TIMESTAMP(3), "submittedIp" TEXT, "submittedUserAgent" TEXT,
  "returnedAt" TIMESTAMP(3), "returnedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "hr_application_form_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_hiring_authorities" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "authority" "HrHiringAuthorityType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_hiring_authorities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_hiring_documents" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "category" TEXT NOT NULL, "side" TEXT, "version" INTEGER NOT NULL,
  "status" "HrEvidenceStatus" NOT NULL DEFAULT 'RECEIVED', "inspectionSource" "HrInspectionSource" NOT NULL,
  "storageName" TEXT NOT NULL, "originalName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL, "malwareScanStatus" TEXT NOT NULL, "note" TEXT, "uploadedBy" TEXT NOT NULL,
  "verifiedBy" TEXT, "verifiedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_hiring_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_identity_checks" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "fieldKey" TEXT NOT NULL, "status" "HrEvidenceStatus" NOT NULL,
  "note" TEXT, "reviewedBy" TEXT NOT NULL, "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_identity_checks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_collateral_items" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "templateItemId" TEXT, "supersedesItemId" TEXT, "type" TEXT NOT NULL, "required" BOOLEAN NOT NULL DEFAULT true,
  "amountRials" DECIMAL(18,0), "identifier" TEXT, "issuerOrGuarantor" TEXT, "receivedAt" TIMESTAMP(3),
  "custodyLocation" TEXT, "status" "HrEvidenceStatus" NOT NULL DEFAULT 'MISSING', "version" INTEGER NOT NULL DEFAULT 1,
  "storageName" TEXT, "originalName" TEXT, "mimeType" TEXT, "size" INTEGER, "sha256" TEXT, "malwareScanStatus" TEXT,
  "note" TEXT, "coordinationReason" TEXT, "recordedBy" TEXT NOT NULL, "approvedBy" TEXT, "approvedAt" TIMESTAMP(3), "returnedAt" TIMESTAMP(3),
  "returnedTo" TEXT, "returnedBy" TEXT, "returnEvidenceNote" TEXT, "returnEvidenceStorageName" TEXT, "returnEvidenceOriginalName" TEXT,
  "returnEvidenceMimeType" TEXT, "returnEvidenceSize" INTEGER, "returnEvidenceSha256" TEXT, "returnEvidenceMalwareScanStatus" TEXT,
  "returnConfirmedBy" TEXT, "returnConfirmedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "hr_collateral_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_collateral_checklist_templates" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "version" INTEGER NOT NULL, "scopeType" TEXT NOT NULL DEFAULT 'GLOBAL',
  "scopeId" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_collateral_checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_collateral_checklist_template_items" (
  "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "type" TEXT NOT NULL, "label" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true, "defaultAmountRials" DECIMAL(18,0), "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "hr_collateral_checklist_template_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_candidate_assessments" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "assessmentType" "HrAssessmentType" NOT NULL, "resultJson" JSONB NOT NULL,
  "storageName" TEXT, "originalName" TEXT, "mimeType" TEXT, "size" INTEGER, "sha256" TEXT, "malwareScanStatus" TEXT,
  "recordedBy" TEXT NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_candidate_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_compensation_snapshots" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "version" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'IRR',
  "componentsJson" JSONB NOT NULL, "totalRials" DECIMAL(18,0) NOT NULL, "proposedBy" TEXT NOT NULL, "preparedBy" TEXT,
  "hrApprovedBy" TEXT, "hrApprovedAt" TIMESTAMP(3), "financeApprovedBy" TEXT, "financeApprovedAt" TIMESTAMP(3),
  "candidateAcceptedAt" TIMESTAMP(3), "candidateAcceptedName" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_compensation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_employment_contract_documents" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "version" INTEGER NOT NULL, "contractNumber" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL, "effectiveTo" TIMESTAMP(3), "storageName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
  "malwareScanStatus" TEXT NOT NULL, "uploadedBy" TEXT NOT NULL, "approvedBy" TEXT, "approvedAt" TIMESTAMP(3),
  "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_employment_contract_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_insurance_enrollments" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL,
  "status" "HrInsuranceEnrollmentStatus" NOT NULL DEFAULT 'NOT_STARTED', "effectiveDate" TIMESTAMP(3), "dueDate" TIMESTAMP(3),
  "note" TEXT, "updatedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "hr_insurance_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_payroll_participations" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "configuredBy" TEXT NOT NULL, "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_payroll_participations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_onboarding_tasks" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "ownerAuthority" "HrHiringAuthorityType" NOT NULL, "activationBlocker" BOOLEAN NOT NULL DEFAULT false,
  "dueDate" TIMESTAMP(3), "status" "HrOnboardingTaskStatus" NOT NULL DEFAULT 'PENDING', "evidenceNote" TEXT,
  "completedBy" TEXT, "completedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL, "assigneePersonnelId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_onboarding_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_hiring_audits" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "actorUserId" TEXT, "actorKind" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "payloadJson" JSONB, "ipAddress" TEXT, "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "hr_hiring_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_candidates_nationalCode_key" ON "hr_candidates"("nationalCode");
CREATE UNIQUE INDEX "hr_candidates_linkedPersonnelId_key" ON "hr_candidates"("linkedPersonnelId");
CREATE UNIQUE INDEX "hr_candidates_foreignIdentityType_foreignIdentityNumber_key" ON "hr_candidates"("foreignIdentityType", "foreignIdentityNumber");
CREATE INDEX "hr_candidates_lastName_firstName_idx" ON "hr_candidates"("lastName", "firstName");
CREATE INDEX "hr_candidates_mobile_idx" ON "hr_candidates"("mobile");
CREATE INDEX "hr_job_applications_stage_outcome_updatedAt_idx" ON "hr_job_applications"("stage", "outcome", "updatedAt");
CREATE INDEX "hr_job_applications_candidateId_createdAt_idx" ON "hr_job_applications"("candidateId", "createdAt");
CREATE INDEX "hr_job_applications_positionId_stage_idx" ON "hr_job_applications"("positionId", "stage");
CREATE UNIQUE INDEX "hr_candidate_invitations_tokenHash_key" ON "hr_candidate_invitations"("tokenHash");
CREATE INDEX "hr_candidate_invitations_applicationId_expiresAt_idx" ON "hr_candidate_invitations"("applicationId", "expiresAt");
CREATE UNIQUE INDEX "hr_application_form_revisions_applicationId_revisionNumber_key" ON "hr_application_form_revisions"("applicationId", "revisionNumber");
CREATE INDEX "hr_application_form_revisions_applicationId_status_idx" ON "hr_application_form_revisions"("applicationId", "status");
CREATE UNIQUE INDEX "hr_hiring_authorities_userId_authority_key" ON "hr_hiring_authorities"("userId", "authority");
CREATE INDEX "hr_hiring_authorities_authority_isActive_idx" ON "hr_hiring_authorities"("authority", "isActive");
CREATE UNIQUE INDEX "hr_hiring_documents_applicationId_category_side_version_key" ON "hr_hiring_documents"("applicationId", "category", "side", "version");
CREATE INDEX "hr_hiring_documents_applicationId_category_status_idx" ON "hr_hiring_documents"("applicationId", "category", "status");
CREATE UNIQUE INDEX "hr_identity_checks_applicationId_fieldKey_key" ON "hr_identity_checks"("applicationId", "fieldKey");
CREATE INDEX "hr_identity_checks_applicationId_status_idx" ON "hr_identity_checks"("applicationId", "status");
CREATE INDEX "hr_collateral_items_applicationId_status_idx" ON "hr_collateral_items"("applicationId", "status");
CREATE UNIQUE INDEX "hr_collateral_items_supersedesItemId_key" ON "hr_collateral_items"("supersedesItemId");
CREATE UNIQUE INDEX "hr_collateral_checklist_templates_name_version_key" ON "hr_collateral_checklist_templates"("name", "version");
CREATE INDEX "hr_collateral_checklist_templates_scopeType_scopeId_isActive_idx" ON "hr_collateral_checklist_templates"("scopeType", "scopeId", "isActive");
CREATE INDEX "hr_collateral_checklist_template_items_templateId_sortOrder_idx" ON "hr_collateral_checklist_template_items"("templateId", "sortOrder");
CREATE INDEX "hr_candidate_assessments_applicationId_assessmentType_recordedAt_idx" ON "hr_candidate_assessments"("applicationId", "assessmentType", "recordedAt");
CREATE UNIQUE INDEX "hr_compensation_snapshots_applicationId_version_key" ON "hr_compensation_snapshots"("applicationId", "version");
CREATE INDEX "hr_compensation_snapshots_applicationId_createdAt_idx" ON "hr_compensation_snapshots"("applicationId", "createdAt");
CREATE UNIQUE INDEX "hr_employment_contract_documents_applicationId_version_key" ON "hr_employment_contract_documents"("applicationId", "version");
CREATE INDEX "hr_employment_contract_documents_applicationId_createdAt_idx" ON "hr_employment_contract_documents"("applicationId", "createdAt");
CREATE UNIQUE INDEX "hr_insurance_enrollments_applicationId_key" ON "hr_insurance_enrollments"("applicationId");
CREATE INDEX "hr_insurance_enrollments_status_dueDate_idx" ON "hr_insurance_enrollments"("status", "dueDate");
CREATE UNIQUE INDEX "hr_payroll_participations_applicationId_key" ON "hr_payroll_participations"("applicationId");
CREATE INDEX "hr_onboarding_tasks_applicationId_status_activationBlocker_idx" ON "hr_onboarding_tasks"("applicationId", "status", "activationBlocker");
CREATE INDEX "hr_onboarding_tasks_assigneePersonnelId_status_idx" ON "hr_onboarding_tasks"("assigneePersonnelId", "status");
CREATE INDEX "hr_hiring_audits_applicationId_createdAt_idx" ON "hr_hiring_audits"("applicationId", "createdAt");
CREATE INDEX "hr_hiring_audits_eventType_createdAt_idx" ON "hr_hiring_audits"("eventType", "createdAt");
CREATE UNIQUE INDEX "hr_employment_relationships_hiringApplicationId_key" ON "hr_employment_relationships"("hiringApplicationId");

ALTER TABLE "hr_candidates" ADD CONSTRAINT "hr_candidates_linkedPersonnelId_fkey" FOREIGN KEY ("linkedPersonnelId") REFERENCES "personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_job_applications" ADD CONSTRAINT "hr_job_applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "hr_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_job_applications" ADD CONSTRAINT "hr_job_applications_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_job_applications" ADD CONSTRAINT "hr_job_applications_collateralTemplateId_fkey" FOREIGN KEY ("collateralTemplateId") REFERENCES "hr_collateral_checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_employment_relationships" ADD CONSTRAINT "hr_employment_relationships_hiringApplicationId_fkey" FOREIGN KEY ("hiringApplicationId") REFERENCES "hr_job_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_candidate_invitations" ADD CONSTRAINT "hr_candidate_invitations_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_application_form_revisions" ADD CONSTRAINT "hr_application_form_revisions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_hiring_documents" ADD CONSTRAINT "hr_hiring_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_identity_checks" ADD CONSTRAINT "hr_identity_checks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_collateral_items" ADD CONSTRAINT "hr_collateral_items_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_collateral_items" ADD CONSTRAINT "hr_collateral_items_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "hr_collateral_checklist_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_collateral_items" ADD CONSTRAINT "hr_collateral_items_supersedesItemId_fkey" FOREIGN KEY ("supersedesItemId") REFERENCES "hr_collateral_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_collateral_checklist_template_items" ADD CONSTRAINT "hr_collateral_checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "hr_collateral_checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_candidate_assessments" ADD CONSTRAINT "hr_candidate_assessments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_compensation_snapshots" ADD CONSTRAINT "hr_compensation_snapshots_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_employment_contract_documents" ADD CONSTRAINT "hr_employment_contract_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_insurance_enrollments" ADD CONSTRAINT "hr_insurance_enrollments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_payroll_participations" ADD CONSTRAINT "hr_payroll_participations_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_onboarding_tasks" ADD CONSTRAINT "hr_onboarding_tasks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_onboarding_tasks" ADD CONSTRAINT "hr_onboarding_tasks_assigneePersonnelId_fkey" FOREIGN KEY ("assigneePersonnelId") REFERENCES "personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_hiring_audits" ADD CONSTRAINT "hr_hiring_audits_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
