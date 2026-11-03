-- CreateEnum
CREATE TYPE "HrAccessLevel" AS ENUM ('VIEW', 'EDIT', 'ADMIN');

-- CreateEnum
CREATE TYPE "HrGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HrResponsibilityAssignmentKind" AS ENUM ('PRIMARY', 'ACTING', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "HrDutyStatus" AS ENUM ('OPEN', 'COMPLETED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HrDutyAssignmentEndReason" AS ENUM ('COMPLETED', 'REASSIGNED', 'WAIVED', 'CANCELLED', 'OWNER_INELIGIBLE', 'SOURCE_CHANGED');

-- CreateEnum
CREATE TYPE "HrFormalAssessmentPlanStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "HrAssessmentExecutionMethod" AS ENUM ('APPLICANT', 'COMPANY');

-- CreateEnum
CREATE TYPE "HrFormalAssessmentResultStatus" AS ENUM ('PENDING', 'COMPLETED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "HrFormalAssessmentAttemptStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "HrFoundationLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "HrReconciliationPrimaryState" AS ENUM ('READY', 'NEEDS_REVIEW', 'LEGACY_ONLY_HISTORY', 'CLASSIFICATION_ERROR');

-- CreateEnum
CREATE TYPE "HrReconciliationReviewOutcome" AS ENUM ('CONFIRMED', 'REMEDIATION_REQUIRED', 'ACCEPTED_LEGACY_ONLY', 'BLOCKED');

-- CreateTable
CREATE TABLE "hr_workspace_catalogs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_workspace_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_feature_catalogs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workspaceCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_feature_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_authority_catalogs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_authority_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_responsibility_type_catalogs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_responsibility_type_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_workspace_access_grants" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceCode" TEXT NOT NULL,
    "level" "HrAccessLevel" NOT NULL,
    "status" "HrGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "provenanceVersion" INTEGER NOT NULL DEFAULT 1,
    "legacyGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_workspace_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_feature_access_grants" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureCode" TEXT NOT NULL,
    "level" "HrAccessLevel" NOT NULL,
    "status" "HrGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "provenanceVersion" INTEGER NOT NULL DEFAULT 1,
    "legacyGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_feature_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_business_authority_grants" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorityCode" TEXT NOT NULL,
    "status" "HrGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "grantedByUserId" TEXT,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "reason" TEXT,
    "provenanceVersion" INTEGER NOT NULL DEFAULT 1,
    "legacyAuthorityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_business_authority_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_named_responsibilities" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "responsibilityTypeCode" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "assignedUserId" TEXT,
    "assignmentKind" "HrResponsibilityAssignmentKind" NOT NULL DEFAULT 'PRIMARY',
    "principalResponsibilityId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "provenanceVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_named_responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_responsibility_destinations" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "responsibilityTypeCode" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "workspaceCode" TEXT NOT NULL,
    "featureCode" TEXT,
    "queueCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_responsibility_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_separation_of_duty_constraints" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "sourceActionCode" TEXT NOT NULL,
    "responsibilityTypeCode" TEXT NOT NULL,
    "conflictRuleJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_separation_of_duty_constraints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_duty_envelopes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "destinationWorkspaceCode" TEXT NOT NULL,
    "destinationFeatureCode" TEXT,
    "allowedFieldsJson" JSONB NOT NULL,
    "allowedEvidenceJson" JSONB NOT NULL,
    "allowedActionCodesJson" JSONB NOT NULL,
    "responseSchemaJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_duty_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_duties" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceActionCode" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "envelopeCode" TEXT NOT NULL,
    "envelopeVersion" INTEGER NOT NULL,
    "destinationWorkspaceCode" TEXT NOT NULL,
    "destinationQueueCode" TEXT NOT NULL,
    "status" "HrDutyStatus" NOT NULL DEFAULT 'OPEN',
    "currentAssigneeUserId" TEXT,
    "responsibilityId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "structuredResultJson" JSONB,
    "respondedAt" TIMESTAMP(3),
    "respondedByUserId" TEXT,
    "predecessorDutyId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_duties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_duty_assignment_history" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "assignedUserId" TEXT,
    "responsibilityId" TEXT,
    "destinationWorkspaceCode" TEXT NOT NULL,
    "destinationQueueCode" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "HrDutyAssignmentEndReason",
    "changedByUserId" TEXT,
    "policyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_duty_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_duty_audit_versions" (
    "id" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "eventCode" TEXT NOT NULL,
    "actorUserId" TEXT,
    "sourceVersion" INTEGER NOT NULL,
    "envelopeVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_duty_audit_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_duty_notification_identities" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "dutyId" TEXT NOT NULL,
    "dutyAuditVersion" INTEGER NOT NULL,
    "recipientUserId" TEXT,
    "channelCode" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "safePayloadJson" JSONB NOT NULL,
    "providerIdentity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_duty_notification_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_formal_assessment_plans" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "HrFormalAssessmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "explicitlyNoAssessment" BOOLEAN NOT NULL DEFAULT false,
    "finalizedByUserId" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "predecessorPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_formal_assessment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_formal_assessment_plan_selections" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "assessmentKind" "HrAssessmentType" NOT NULL,
    "selected" BOOLEAN NOT NULL,
    "executionMethod" "HrAssessmentExecutionMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_formal_assessment_plan_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_formal_assessment_results" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "planSelectionId" TEXT NOT NULL,
    "assessmentKind" "HrAssessmentType" NOT NULL,
    "resultVersion" INTEGER NOT NULL,
    "status" "HrFormalAssessmentResultStatus" NOT NULL DEFAULT 'PENDING',
    "resultJson" JSONB,
    "recordedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3),
    "supersedesResultId" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedByUserId" TEXT,
    "invalidationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_formal_assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_formal_assessment_attempts" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "executionMethod" "HrAssessmentExecutionMethod" NOT NULL,
    "status" "HrFormalAssessmentAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "actorUserId" TEXT,
    "responseJson" JSONB,

    CONSTRAINT "hr_formal_assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_formal_assessment_evidence_links" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "hiringDocumentId" TEXT,
    "externalReference" TEXT,
    "evidenceHash" TEXT,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_formal_assessment_evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_assessment_migration_events" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_assessment_migration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_foundation_lifecycle_versions" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "HrFoundationLifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_foundation_lifecycle_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_position_capacity_changes" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "previousCapacity" INTEGER NOT NULL,
    "newCapacity" INTEGER NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_position_capacity_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_reconciliation_records" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "primaryState" "HrReconciliationPrimaryState" NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "detailsJson" JSONB NOT NULL,
    "cutoverBlocker" BOOLEAN NOT NULL DEFAULT false,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_reconciliation_attention_flags" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "flagCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "detailsJson" JSONB,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionReason" TEXT,

    CONSTRAINT "hr_reconciliation_attention_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_reconciliation_reviews" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "outcome" "HrReconciliationReviewOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_reconciliation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr_cutover_blocker_projections" (
    "id" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "blockerCode" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedAt" TIMESTAMP(3),

    CONSTRAINT "hr_cutover_blocker_projections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_workspace_catalogs_code_key" ON "hr_workspace_catalogs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_feature_catalogs_code_key" ON "hr_feature_catalogs"("code");

-- CreateIndex
CREATE INDEX "hr_feature_catalogs_workspaceCode_isActive_idx" ON "hr_feature_catalogs"("workspaceCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hr_authority_catalogs_code_key" ON "hr_authority_catalogs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_responsibility_type_catalogs_code_key" ON "hr_responsibility_type_catalogs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hr_workspace_access_grants_stableKey_key" ON "hr_workspace_access_grants"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_workspace_access_grants_legacyGrantId_key" ON "hr_workspace_access_grants"("legacyGrantId");

-- CreateIndex
CREATE INDEX "hr_workspace_access_grants_userId_workspaceCode_status_effe_idx" ON "hr_workspace_access_grants"("userId", "workspaceCode", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "hr_feature_access_grants_stableKey_key" ON "hr_feature_access_grants"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_feature_access_grants_legacyGrantId_key" ON "hr_feature_access_grants"("legacyGrantId");

-- CreateIndex
CREATE INDEX "hr_feature_access_grants_userId_featureCode_status_effectiv_idx" ON "hr_feature_access_grants"("userId", "featureCode", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "hr_business_authority_grants_stableKey_key" ON "hr_business_authority_grants"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_business_authority_grants_legacyAuthorityId_key" ON "hr_business_authority_grants"("legacyAuthorityId");

-- CreateIndex
CREATE INDEX "hr_business_authority_grants_userId_authorityCode_status_ef_idx" ON "hr_business_authority_grants"("userId", "authorityCode", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "hr_named_responsibilities_stableKey_key" ON "hr_named_responsibilities"("stableKey");

-- CreateIndex
CREATE INDEX "hr_named_responsibilities_responsibilityTypeCode_scopeType__idx" ON "hr_named_responsibilities"("responsibilityTypeCode", "scopeType", "scopeId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "hr_named_responsibilities_assignedUserId_effectiveFrom_effe_idx" ON "hr_named_responsibilities"("assignedUserId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "hr_responsibility_destinations_stableKey_key" ON "hr_responsibility_destinations"("stableKey");

-- CreateIndex
CREATE INDEX "hr_responsibility_destinations_responsibilityTypeCode_scope_idx" ON "hr_responsibility_destinations"("responsibilityTypeCode", "scopeType", "scopeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hr_separation_of_duty_constraints_stableKey_key" ON "hr_separation_of_duty_constraints"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_separation_of_duty_constraints_sourceActionCode_responsi_key" ON "hr_separation_of_duty_constraints"("sourceActionCode", "responsibilityTypeCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duty_envelopes_code_version_key" ON "hr_duty_envelopes"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duties_stableKey_key" ON "hr_duties"("stableKey");

-- CreateIndex
CREATE INDEX "hr_duties_currentAssigneeUserId_status_dueAt_idx" ON "hr_duties"("currentAssigneeUserId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "hr_duties_destinationWorkspaceCode_destinationQueueCode_sta_idx" ON "hr_duties"("destinationWorkspaceCode", "destinationQueueCode", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duties_sourceType_sourceId_sourceActionCode_sourceVersio_key" ON "hr_duties"("sourceType", "sourceId", "sourceActionCode", "sourceVersion");

-- CreateIndex
CREATE INDEX "hr_duty_assignment_history_assignedUserId_endedAt_idx" ON "hr_duty_assignment_history"("assignedUserId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duty_assignment_history_dutyId_sequence_key" ON "hr_duty_assignment_history"("dutyId", "sequence");

-- CreateIndex
CREATE INDEX "hr_duty_audit_versions_dutyId_createdAt_idx" ON "hr_duty_audit_versions"("dutyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duty_audit_versions_dutyId_version_key" ON "hr_duty_audit_versions"("dutyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duty_notification_identities_stableKey_key" ON "hr_duty_notification_identities"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_duty_notification_identities_dutyId_dutyAuditVersion_rec_key" ON "hr_duty_notification_identities"("dutyId", "dutyAuditVersion", "recipientUserId", "channelCode");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_plans_stableKey_key" ON "hr_formal_assessment_plans"("stableKey");

-- CreateIndex
CREATE INDEX "hr_formal_assessment_plans_applicationId_status_idx" ON "hr_formal_assessment_plans"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_plans_applicationId_version_key" ON "hr_formal_assessment_plans"("applicationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_plan_selections_planId_assessmentKind_key" ON "hr_formal_assessment_plan_selections"("planId", "assessmentKind");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_results_stableKey_key" ON "hr_formal_assessment_results"("stableKey");

-- CreateIndex
CREATE INDEX "hr_formal_assessment_results_planSelectionId_status_idx" ON "hr_formal_assessment_results"("planSelectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_results_applicationId_assessmentKind_r_key" ON "hr_formal_assessment_results"("applicationId", "assessmentKind", "resultVersion");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_attempts_stableKey_key" ON "hr_formal_assessment_attempts"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_attempts_resultId_attemptNumber_key" ON "hr_formal_assessment_attempts"("resultId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hr_formal_assessment_evidence_links_stableKey_key" ON "hr_formal_assessment_evidence_links"("stableKey");

-- CreateIndex
CREATE INDEX "hr_formal_assessment_evidence_links_attemptId_evidenceType_idx" ON "hr_formal_assessment_evidence_links"("attemptId", "evidenceType");

-- CreateIndex
CREATE UNIQUE INDEX "hr_assessment_migration_events_stableKey_key" ON "hr_assessment_migration_events"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_assessment_migration_events_applicationId_eventCode_sour_key" ON "hr_assessment_migration_events"("applicationId", "eventCode", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "hr_foundation_lifecycle_versions_stableKey_key" ON "hr_foundation_lifecycle_versions"("stableKey");

-- CreateIndex
CREATE INDEX "hr_foundation_lifecycle_versions_entityType_entityId_effect_idx" ON "hr_foundation_lifecycle_versions"("entityType", "entityId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "hr_foundation_lifecycle_versions_entityType_entityId_versio_key" ON "hr_foundation_lifecycle_versions"("entityType", "entityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_position_capacity_changes_stableKey_key" ON "hr_position_capacity_changes"("stableKey");

-- CreateIndex
CREATE INDEX "hr_position_capacity_changes_positionId_effectiveAt_idx" ON "hr_position_capacity_changes"("positionId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "hr_position_capacity_changes_positionId_version_key" ON "hr_position_capacity_changes"("positionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_records_stableKey_key" ON "hr_reconciliation_records"("stableKey");

-- CreateIndex
CREATE INDEX "hr_reconciliation_records_primaryState_cutoverBlocker_idx" ON "hr_reconciliation_records"("primaryState", "cutoverBlocker");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_records_sourceType_sourceId_key" ON "hr_reconciliation_records"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_attention_flags_stableKey_key" ON "hr_reconciliation_attention_flags"("stableKey");

-- CreateIndex
CREATE INDEX "hr_reconciliation_attention_flags_flagCode_isActive_idx" ON "hr_reconciliation_attention_flags"("flagCode", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_attention_flags_reconciliationId_flagCode_key" ON "hr_reconciliation_attention_flags"("reconciliationId", "flagCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_reviews_stableKey_key" ON "hr_reconciliation_reviews"("stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "hr_reconciliation_reviews_reconciliationId_version_key" ON "hr_reconciliation_reviews"("reconciliationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "hr_cutover_blocker_projections_stableKey_key" ON "hr_cutover_blocker_projections"("stableKey");

-- CreateIndex
CREATE INDEX "hr_cutover_blocker_projections_isActive_blockerCode_idx" ON "hr_cutover_blocker_projections"("isActive", "blockerCode");

-- CreateIndex
CREATE UNIQUE INDEX "hr_cutover_blocker_projections_reconciliationId_blockerCode_key" ON "hr_cutover_blocker_projections"("reconciliationId", "blockerCode", "sourceVersion");

-- AddForeignKey
ALTER TABLE "hr_feature_catalogs" ADD CONSTRAINT "hr_feature_catalogs_workspaceCode_fkey" FOREIGN KEY ("workspaceCode") REFERENCES "hr_workspace_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_workspace_access_grants" ADD CONSTRAINT "hr_workspace_access_grants_workspaceCode_fkey" FOREIGN KEY ("workspaceCode") REFERENCES "hr_workspace_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_feature_access_grants" ADD CONSTRAINT "hr_feature_access_grants_featureCode_fkey" FOREIGN KEY ("featureCode") REFERENCES "hr_feature_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_business_authority_grants" ADD CONSTRAINT "hr_business_authority_grants_authorityCode_fkey" FOREIGN KEY ("authorityCode") REFERENCES "hr_authority_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_named_responsibilities" ADD CONSTRAINT "hr_named_responsibilities_responsibilityTypeCode_fkey" FOREIGN KEY ("responsibilityTypeCode") REFERENCES "hr_responsibility_type_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_named_responsibilities" ADD CONSTRAINT "hr_named_responsibilities_principalResponsibilityId_fkey" FOREIGN KEY ("principalResponsibilityId") REFERENCES "hr_named_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_responsibility_destinations" ADD CONSTRAINT "hr_responsibility_destinations_responsibilityTypeCode_fkey" FOREIGN KEY ("responsibilityTypeCode") REFERENCES "hr_responsibility_type_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_separation_of_duty_constraints" ADD CONSTRAINT "hr_separation_of_duty_constraints_responsibilityTypeCode_fkey" FOREIGN KEY ("responsibilityTypeCode") REFERENCES "hr_responsibility_type_catalogs"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duties" ADD CONSTRAINT "hr_duties_envelopeCode_envelopeVersion_fkey" FOREIGN KEY ("envelopeCode", "envelopeVersion") REFERENCES "hr_duty_envelopes"("code", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duties" ADD CONSTRAINT "hr_duties_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "hr_named_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duties" ADD CONSTRAINT "hr_duties_predecessorDutyId_fkey" FOREIGN KEY ("predecessorDutyId") REFERENCES "hr_duties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duty_assignment_history" ADD CONSTRAINT "hr_duty_assignment_history_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "hr_duties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duty_assignment_history" ADD CONSTRAINT "hr_duty_assignment_history_responsibilityId_fkey" FOREIGN KEY ("responsibilityId") REFERENCES "hr_named_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duty_audit_versions" ADD CONSTRAINT "hr_duty_audit_versions_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "hr_duties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duty_notification_identities" ADD CONSTRAINT "hr_duty_notification_identities_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "hr_duties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_duty_notification_identities" ADD CONSTRAINT "hr_duty_notification_identities_dutyId_dutyAuditVersion_fkey" FOREIGN KEY ("dutyId", "dutyAuditVersion") REFERENCES "hr_duty_audit_versions"("dutyId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_plans" ADD CONSTRAINT "hr_formal_assessment_plans_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_plans" ADD CONSTRAINT "hr_formal_assessment_plans_predecessorPlanId_fkey" FOREIGN KEY ("predecessorPlanId") REFERENCES "hr_formal_assessment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_plan_selections" ADD CONSTRAINT "hr_formal_assessment_plan_selections_planId_fkey" FOREIGN KEY ("planId") REFERENCES "hr_formal_assessment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_planSelectionId_fkey" FOREIGN KEY ("planSelectionId") REFERENCES "hr_formal_assessment_plan_selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_supersedesResultId_fkey" FOREIGN KEY ("supersedesResultId") REFERENCES "hr_formal_assessment_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_attempts" ADD CONSTRAINT "hr_formal_assessment_attempts_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "hr_formal_assessment_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_evidence_links" ADD CONSTRAINT "hr_formal_assessment_evidence_links_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "hr_formal_assessment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_formal_assessment_evidence_links" ADD CONSTRAINT "hr_formal_assessment_evidence_links_hiringDocumentId_fkey" FOREIGN KEY ("hiringDocumentId") REFERENCES "hr_hiring_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_assessment_migration_events" ADD CONSTRAINT "hr_assessment_migration_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_position_capacity_changes" ADD CONSTRAINT "hr_position_capacity_changes_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reconciliation_attention_flags" ADD CONSTRAINT "hr_reconciliation_attention_flags_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "hr_reconciliation_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_reconciliation_reviews" ADD CONSTRAINT "hr_reconciliation_reviews_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "hr_reconciliation_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_cutover_blocker_projections" ADD CONSTRAINT "hr_cutover_blocker_projections_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "hr_reconciliation_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddConstraint
ALTER TABLE "hr_workspace_catalogs" ADD CONSTRAINT "hr_workspace_catalogs_version_check" CHECK ("version" > 0);
ALTER TABLE "hr_feature_catalogs" ADD CONSTRAINT "hr_feature_catalogs_version_check" CHECK ("version" > 0);
ALTER TABLE "hr_authority_catalogs" ADD CONSTRAINT "hr_authority_catalogs_version_check" CHECK ("version" > 0);
ALTER TABLE "hr_responsibility_type_catalogs" ADD CONSTRAINT "hr_responsibility_type_catalogs_version_check" CHECK ("version" > 0);
ALTER TABLE "hr_workspace_access_grants" ADD CONSTRAINT "hr_workspace_access_grants_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "hr_feature_access_grants" ADD CONSTRAINT "hr_feature_access_grants_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "hr_business_authority_grants" ADD CONSTRAINT "hr_business_authority_grants_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "hr_named_responsibilities" ADD CONSTRAINT "hr_named_responsibilities_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "hr_named_responsibilities" ADD CONSTRAINT "hr_named_responsibilities_acting_principal_check" CHECK (("assignmentKind" = 'PRIMARY' AND "principalResponsibilityId" IS NULL) OR ("assignmentKind" <> 'PRIMARY' AND "principalResponsibilityId" IS NOT NULL));
ALTER TABLE "hr_duties" ADD CONSTRAINT "hr_duties_versions_check" CHECK ("sourceVersion" > 0 AND "envelopeVersion" > 0);
ALTER TABLE "hr_duties" ADD CONSTRAINT "hr_duties_response_check" CHECK (("status" = 'COMPLETED' AND "structuredResultJson" IS NOT NULL AND "respondedAt" IS NOT NULL AND "respondedByUserId" IS NOT NULL) OR ("status" <> 'COMPLETED' AND "respondedAt" IS NULL AND "respondedByUserId" IS NULL));
ALTER TABLE "hr_duty_assignment_history" ADD CONSTRAINT "hr_duty_assignment_history_dates_check" CHECK (("endedAt" IS NULL AND "endReason" IS NULL) OR ("endedAt" >= "startedAt" AND "endReason" IS NOT NULL));
ALTER TABLE "hr_duty_assignment_history" ADD CONSTRAINT "hr_duty_assignment_history_versions_check" CHECK ("sequence" > 0 AND "policyVersion" > 0);
ALTER TABLE "hr_duty_audit_versions" ADD CONSTRAINT "hr_duty_audit_versions_versions_check" CHECK ("version" > 0 AND "sourceVersion" > 0 AND "envelopeVersion" > 0 AND "policyVersion" > 0);
ALTER TABLE "hr_formal_assessment_plans" ADD CONSTRAINT "hr_formal_assessment_plans_version_check" CHECK ("version" > 0);
ALTER TABLE "hr_formal_assessment_plan_selections" ADD CONSTRAINT "hr_formal_assessment_plan_selections_method_check" CHECK (("selected" AND "executionMethod" IS NOT NULL) OR (NOT "selected" AND "executionMethod" IS NULL));
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_version_check" CHECK ("resultVersion" > 0);
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_completion_check" CHECK (("status" = 'COMPLETED' AND "resultJson" IS NOT NULL AND "recordedAt" IS NOT NULL) OR "status" <> 'COMPLETED');
ALTER TABLE "hr_formal_assessment_results" ADD CONSTRAINT "hr_formal_assessment_results_invalidation_check" CHECK (("status" = 'INVALIDATED' AND "invalidatedAt" IS NOT NULL AND "invalidationReason" IS NOT NULL) OR "status" <> 'INVALIDATED');
ALTER TABLE "hr_formal_assessment_attempts" ADD CONSTRAINT "hr_formal_assessment_attempts_number_check" CHECK ("attemptNumber" > 0);
ALTER TABLE "hr_formal_assessment_attempts" ADD CONSTRAINT "hr_formal_assessment_attempts_completion_check" CHECK (("status" = 'COMPLETED' AND "completedAt" IS NOT NULL) OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL));
ALTER TABLE "hr_formal_assessment_evidence_links" ADD CONSTRAINT "hr_formal_assessment_evidence_links_target_check" CHECK ("hiringDocumentId" IS NOT NULL OR "externalReference" IS NOT NULL);
ALTER TABLE "hr_foundation_lifecycle_versions" ADD CONSTRAINT "hr_foundation_lifecycle_versions_dates_check" CHECK ("version" > 0 AND ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"));
ALTER TABLE "hr_position_capacity_changes" ADD CONSTRAINT "hr_position_capacity_changes_capacity_check" CHECK ("version" > 0 AND "previousCapacity" > 0 AND "newCapacity" > 0);
ALTER TABLE "hr_reconciliation_records" ADD CONSTRAINT "hr_reconciliation_records_version_check" CHECK ("stateVersion" > 0);
ALTER TABLE "hr_reconciliation_records" ADD CONSTRAINT "hr_reconciliation_records_classification_check" CHECK ("primaryState" <> 'CLASSIFICATION_ERROR' OR "cutoverBlocker");
ALTER TABLE "hr_reconciliation_attention_flags" ADD CONSTRAINT "hr_reconciliation_attention_flags_resolution_check" CHECK (("isActive" AND "resolvedAt" IS NULL) OR (NOT "isActive" AND "resolvedAt" IS NOT NULL AND "resolutionReason" IS NOT NULL));
ALTER TABLE "hr_reconciliation_reviews" ADD CONSTRAINT "hr_reconciliation_reviews_version_check" CHECK ("version" > 0 AND length(trim("reason")) > 0);
ALTER TABLE "hr_cutover_blocker_projections" ADD CONSTRAINT "hr_cutover_blocker_projections_resolution_check" CHECK (("isActive" AND "clearedAt" IS NULL) OR (NOT "isActive" AND "clearedAt" IS NOT NULL));

-- Only one current plan or current duty assignment may exist at a time.
CREATE UNIQUE INDEX "hr_formal_assessment_plans_one_active_per_application" ON "hr_formal_assessment_plans"("applicationId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "hr_duty_assignment_history_one_current_per_duty" ON "hr_duty_assignment_history"("dutyId") WHERE "endedAt" IS NULL;
