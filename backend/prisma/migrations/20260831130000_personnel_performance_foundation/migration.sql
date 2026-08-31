CREATE TYPE "PerformanceArtifactLifecycle" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'CANCELLED');
CREATE TYPE "PerformanceEvaluationStatus" AS ENUM ('DRAFT', 'READY_FOR_SUBMISSION', 'UNDER_REVIEW', 'ACCEPTED', 'NOT_EVALUABLE', 'INVALIDATED', 'CANCELLED');
CREATE TYPE "PerformanceSectionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'ACCEPTED', 'NOT_EVALUABLE', 'INVALIDATED', 'CANCELLED');
CREATE TYPE "PerformanceReviewDecision" AS ENUM ('ACCEPTED', 'REJECTED', 'NOT_EVALUABLE');
CREATE TYPE "PerformanceResultStatus" AS ENUM ('EFFECTIVE', 'SUSPENDED', 'SUPERSEDED', 'EXPIRED');
CREATE TYPE "PerformanceProjectionState" AS ENUM ('UNEVALUATED', 'NEEDS_NEW_EVALUATION', 'LEVEL', 'TEMPORARILY_UNAVAILABLE');
CREATE TYPE "PerformanceCorrectionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE "PerformanceExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'DOWNLOADED', 'FAILED', 'EXPIRED', 'DELETED');
CREATE TYPE "PerformanceRolloutPhase" AS ENUM ('SCHEMA_PROTECTION', 'POLICY_DARK_LAUNCH', 'READINESS', 'SUPERVISOR_HR_PILOT', 'RESULT_LEVEL_BADGE', 'ANALYTICS_RANKING_CALIBRATION', 'PDF_EXCEL_EXPORT', 'CONSEQUENCE_HANDOFF', 'EXPANSION_RETIREMENT');

CREATE TABLE "performance_encrypted_payloads" (
  "id" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payloadKind" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "format" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "cipher" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "iv" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "plaintextHash" TEXT NOT NULL,
  "aadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_encrypted_payloads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_encrypted_payloads_crypto_check" CHECK (
    "format" = 'sabalan-personnel-performance' AND
    "formatVersion" = 1 AND
    "cipher" = 'aes-256-gcm' AND
    octet_length("iv") = 12 AND
    octet_length("authTag") = 16 AND
    octet_length("ciphertext") > 0 AND
    length("plaintextHash") = 64 AND
    length("aadHash") = 64
  )
);
CREATE UNIQUE INDEX "performance_encrypted_payloads_aggregate_payload_version_key" ON "performance_encrypted_payloads"("aggregateType", "aggregateId", "payloadKind", "schemaVersion");
CREATE INDEX "performance_encrypted_payloads_key_created_idx" ON "performance_encrypted_payloads"("keyId", "createdAt");

CREATE TABLE "performance_subjects" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "nonDisplayKey" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "employmentRelationshipId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_subjects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_subjects_personnel_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_subjects_relationship_fkey" FOREIGN KEY ("employmentRelationshipId") REFERENCES "hr_employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_subjects_actor_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_subjects_stable_key" ON "performance_subjects"("stableKey");
CREATE UNIQUE INDEX "performance_subjects_non_display_key" ON "performance_subjects"("nonDisplayKey");
CREATE UNIQUE INDEX "performance_subjects_personnel_relationship_key" ON "performance_subjects"("personnelId", "employmentRelationshipId");
CREATE INDEX "performance_subjects_relationship_created_idx" ON "performance_subjects"("employmentRelationshipId", "createdAt");

CREATE TABLE "performance_policy_versions" (
  "id" TEXT NOT NULL,
  "policyKind" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "predecessorId" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT,
  "publicationReason" TEXT,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_policy_versions_predecessor_fkey" FOREIGN KEY ("predecessorId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_versions_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_versions_publisher_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_versions_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_versions_publication_check" CHECK (
    ("lifecycle" = 'DRAFT' AND "publishedAt" IS NULL) OR
    ("lifecycle" <> 'DRAFT' AND "publishedAt" IS NOT NULL AND "publishedByUserId" IS NOT NULL AND "publicationReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "performance_policy_versions_kind_version_key" ON "performance_policy_versions"("policyKind", "version");
CREATE UNIQUE INDEX "performance_policy_versions_payload_key" ON "performance_policy_versions"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_policy_versions_one_active_kind" ON "performance_policy_versions"("policyKind") WHERE "lifecycle" = 'ACTIVE';
CREATE INDEX "performance_policy_versions_kind_lifecycle_effective_idx" ON "performance_policy_versions"("policyKind", "lifecycle", "effectiveFrom");

CREATE TABLE "performance_criterion_identities" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "conceptCode" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_criterion_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_criterion_identities_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_criterion_identities_stable_key" ON "performance_criterion_identities"("stableKey");
CREATE UNIQUE INDEX "performance_criterion_identities_concept_key" ON "performance_criterion_identities"("conceptCode");

CREATE TABLE "performance_criterion_versions" (
  "id" TEXT NOT NULL,
  "criterionIdentityId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "predecessorId" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_criterion_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_criterion_versions_identity_fkey" FOREIGN KEY ("criterionIdentityId") REFERENCES "performance_criterion_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_criterion_versions_predecessor_fkey" FOREIGN KEY ("predecessorId") REFERENCES "performance_criterion_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_criterion_versions_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_criterion_versions_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_criterion_versions_identity_version_key" ON "performance_criterion_versions"("criterionIdentityId", "version");
CREATE UNIQUE INDEX "performance_criterion_versions_payload_key" ON "performance_criterion_versions"("encryptedPayloadId");
CREATE INDEX "performance_criterion_versions_lifecycle_effective_idx" ON "performance_criterion_versions"("lifecycle", "effectiveFrom");

CREATE TABLE "performance_template_versions" (
  "id" TEXT NOT NULL,
  "templateKind" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "predecessorId" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "contentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_template_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_template_versions_predecessor_fkey" FOREIGN KEY ("predecessorId") REFERENCES "performance_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_template_versions_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_template_versions_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_template_versions_owner_version_key" ON "performance_template_versions"("templateKind", "ownerType", "ownerId", "version");
CREATE UNIQUE INDEX "performance_template_versions_payload_key" ON "performance_template_versions"("encryptedPayloadId");
CREATE INDEX "performance_template_versions_lifecycle_effective_idx" ON "performance_template_versions"("lifecycle", "effectiveFrom");

CREATE TABLE "performance_cohort_versions" (
  "id" TEXT NOT NULL,
  "cohortKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "membershipHash" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3),
  "activationReason" TEXT,
  "activatedByUserId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_cohort_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_cohort_versions_activator_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_cohort_versions_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_cohort_versions_key_version_key" ON "performance_cohort_versions"("cohortKey", "version");
CREATE UNIQUE INDEX "performance_cohort_versions_one_active_key" ON "performance_cohort_versions"("cohortKey") WHERE "lifecycle" = 'ACTIVE';
CREATE INDEX "performance_cohort_versions_lifecycle_effective_idx" ON "performance_cohort_versions"("lifecycle", "effectiveFrom");

CREATE TABLE "performance_cohort_members" (
  "id" TEXT NOT NULL,
  "cohortVersionId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "eligibilityHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_cohort_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_cohort_members_version_fkey" FOREIGN KEY ("cohortVersionId") REFERENCES "performance_cohort_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_cohort_members_subject_fkey" FOREIGN KEY ("subjectId") REFERENCES "performance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_cohort_members_version_subject_key" ON "performance_cohort_members"("cohortVersionId", "subjectId");
CREATE INDEX "performance_cohort_members_subject_version_idx" ON "performance_cohort_members"("subjectId", "cohortVersionId");

CREATE TABLE "performance_feature_phase_versions" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "phase" "PerformanceRolloutPhase" NOT NULL,
  "releaseEnabled" BOOLEAN NOT NULL DEFAULT false,
  "cohortVersionId" TEXT,
  "predecessorId" TEXT,
  "reason" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_feature_phase_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_feature_phase_versions_cohort_fkey" FOREIGN KEY ("cohortVersionId") REFERENCES "performance_cohort_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_feature_phase_versions_predecessor_fkey" FOREIGN KEY ("predecessorId") REFERENCES "performance_feature_phase_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_feature_phase_versions_actor_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_feature_phase_versions_version_key" ON "performance_feature_phase_versions"("version");
CREATE INDEX "performance_feature_phase_versions_effective_version_idx" ON "performance_feature_phase_versions"("effectiveFrom", "version");

CREATE TABLE "performance_safety_pauses" (
  "id" TEXT NOT NULL,
  "phaseVersionId" TEXT NOT NULL,
  "cohortVersionId" TEXT,
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "startedByUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedByUserId" TEXT,
  "resumedAt" TIMESTAMP(3),
  "resumeReason" TEXT,
  CONSTRAINT "performance_safety_pauses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_safety_pauses_phase_fkey" FOREIGN KEY ("phaseVersionId") REFERENCES "performance_feature_phase_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_safety_pauses_cohort_fkey" FOREIGN KEY ("cohortVersionId") REFERENCES "performance_cohort_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_safety_pauses_starter_fkey" FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_safety_pauses_resumer_fkey" FOREIGN KEY ("resumedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_safety_pauses_lifecycle_check" CHECK (
    ("status" = 'ACTIVE' AND "resumedAt" IS NULL AND "resumedByUserId" IS NULL) OR
    ("status" = 'RESUMED' AND "resumedAt" IS NOT NULL AND "resumedByUserId" IS NOT NULL AND "resumeReason" IS NOT NULL)
  )
);
CREATE INDEX "performance_safety_pauses_status_started_idx" ON "performance_safety_pauses"("status", "startedAt");
CREATE INDEX "performance_safety_pauses_cohort_status_idx" ON "performance_safety_pauses"("cohortVersionId", "status");
CREATE UNIQUE INDEX "performance_safety_pauses_one_global_active" ON "performance_safety_pauses"("scope") WHERE "status" = 'ACTIVE' AND "scope" = 'ALL';

CREATE TABLE "performance_cycles" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "planPolicyVersionId" TEXT,
  "cohortVersionId" TEXT,
  "labelFa" TEXT NOT NULL,
  "measurementFrom" TIMESTAMP(3) NOT NULL,
  "measurementTo" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_cycles_policy_fkey" FOREIGN KEY ("planPolicyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_cycles_cohort_fkey" FOREIGN KEY ("cohortVersionId") REFERENCES "performance_cohort_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_cycles_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_cycles_period_check" CHECK ("measurementFrom" < "measurementTo")
);
CREATE UNIQUE INDEX "performance_cycles_stable_key" ON "performance_cycles"("stableKey");
CREATE INDEX "performance_cycles_measurement_idx" ON "performance_cycles"("measurementFrom", "measurementTo");

CREATE TABLE "performance_evaluations" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "cycleId" TEXT,
  "measurementFrom" TIMESTAMP(3) NOT NULL,
  "measurementTo" TIMESTAMP(3) NOT NULL,
  "status" "PerformanceEvaluationStatus" NOT NULL DEFAULT 'DRAFT',
  "contextSnapshotId" TEXT,
  "acceptedResultId" TEXT,
  "writerVersion" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_evaluations_subject_fkey" FOREIGN KEY ("subjectId") REFERENCES "performance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluations_cycle_fkey" FOREIGN KEY ("cycleId") REFERENCES "performance_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluations_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluations_period_check" CHECK ("measurementFrom" < "measurementTo")
);
CREATE UNIQUE INDEX "performance_evaluations_stable_key" ON "performance_evaluations"("stableKey");
CREATE UNIQUE INDEX "performance_evaluations_context_snapshot_key" ON "performance_evaluations"("contextSnapshotId");
CREATE UNIQUE INDEX "performance_evaluations_accepted_result_key" ON "performance_evaluations"("acceptedResultId");
CREATE INDEX "performance_evaluations_subject_period_idx" ON "performance_evaluations"("subjectId", "measurementFrom", "measurementTo");
CREATE INDEX "performance_evaluations_status_created_idx" ON "performance_evaluations"("status", "createdAt");

CREATE TABLE "performance_evaluation_sections" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "employmentAssignmentId" TEXT NOT NULL,
  "responsibleSupervisorPersonnelId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3) NOT NULL,
  "allocationPercent" DECIMAL(5,2) NOT NULL,
  "status" "PerformanceSectionStatus" NOT NULL DEFAULT 'DRAFT',
  "templateSnapshotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_evaluation_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_evaluation_sections_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluation_sections_assignment_fkey" FOREIGN KEY ("employmentAssignmentId") REFERENCES "hr_employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluation_sections_supervisor_fkey" FOREIGN KEY ("responsibleSupervisorPersonnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_evaluation_sections_period_check" CHECK ("effectiveFrom" < "effectiveTo"),
  CONSTRAINT "performance_evaluation_sections_allocation_check" CHECK ("allocationPercent" > 0 AND "allocationPercent" <= 100)
);
CREATE UNIQUE INDEX "performance_evaluation_sections_assignment_period_key" ON "performance_evaluation_sections"("evaluationId", "employmentAssignmentId", "effectiveFrom");
CREATE UNIQUE INDEX "performance_evaluation_sections_template_snapshot_key" ON "performance_evaluation_sections"("templateSnapshotId");
CREATE INDEX "performance_evaluation_sections_supervisor_status_idx" ON "performance_evaluation_sections"("responsibleSupervisorPersonnelId", "status");

CREATE TABLE "performance_snapshots" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "sectionId" TEXT,
  "snapshotKind" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_snapshots_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_snapshots_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "performance_evaluation_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_snapshots_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_snapshots_payload_key" ON "performance_snapshots"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_snapshots_evaluation_kind_version_key" ON "performance_snapshots"("evaluationId", "sectionId", "snapshotKind", "version");
CREATE INDEX "performance_snapshots_evaluation_captured_idx" ON "performance_snapshots"("evaluationId", "capturedAt");

CREATE TABLE "performance_drafts" (
  "id" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "supervisorUserId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "encryptedPayloadId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_drafts_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "performance_evaluation_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_drafts_supervisor_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_drafts_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_drafts_payload_key" ON "performance_drafts"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_drafts_section_supervisor_revision_key" ON "performance_drafts"("sectionId", "supervisorUserId", "revision");
CREATE INDEX "performance_drafts_section_status_idx" ON "performance_drafts"("sectionId", "status");

CREATE TABLE "performance_submissions" (
  "id" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "draftId" TEXT,
  "supervisorUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_submissions_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "performance_evaluation_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_submissions_draft_fkey" FOREIGN KEY ("draftId") REFERENCES "performance_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_submissions_supervisor_fkey" FOREIGN KEY ("supervisorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_submissions_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_submissions_payload_key" ON "performance_submissions"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_submissions_section_version_key" ON "performance_submissions"("sectionId", "version");
CREATE INDEX "performance_submissions_supervisor_submitted_idx" ON "performance_submissions"("supervisorUserId", "submittedAt");

CREATE TABLE "performance_reviews" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "decision" "PerformanceReviewDecision" NOT NULL,
  "encryptedPayloadId" TEXT,
  "selfReview" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_reviews_submission_fkey" FOREIGN KEY ("submissionId") REFERENCES "performance_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_reviews_reviewer_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_reviews_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_reviews_payload_key" ON "performance_reviews"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_reviews_submission_version_key" ON "performance_reviews"("submissionId", "version");
CREATE INDEX "performance_reviews_reviewer_decided_idx" ON "performance_reviews"("reviewerUserId", "decidedAt");

CREATE TABLE "performance_calculation_traces" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "traceVersion" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_calculation_traces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_calculation_traces_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_calculation_traces_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_calculation_traces_payload_key" ON "performance_calculation_traces"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_calculation_traces_evaluation_version_key" ON "performance_calculation_traces"("evaluationId", "traceVersion");

CREATE TABLE "performance_accepted_results" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PerformanceResultStatus" NOT NULL DEFAULT 'EFFECTIVE',
  "calculationTraceId" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "exactScoreHash" TEXT NOT NULL,
  "levelCode" TEXT NOT NULL,
  "levelPolicyVersionId" TEXT NOT NULL,
  "supersedesResultId" TEXT,
  "acceptedByUserId" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_accepted_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_accepted_results_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_trace_fkey" FOREIGN KEY ("calculationTraceId") REFERENCES "performance_calculation_traces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_policy_fkey" FOREIGN KEY ("levelPolicyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_supersedes_fkey" FOREIGN KEY ("supersedesResultId") REFERENCES "performance_accepted_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_actor_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_accepted_results_expiry_check" CHECK ("expiresAt" > "acceptedAt")
);
CREATE UNIQUE INDEX "performance_accepted_results_trace_key" ON "performance_accepted_results"("calculationTraceId");
CREATE UNIQUE INDEX "performance_accepted_results_payload_key" ON "performance_accepted_results"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_accepted_results_evaluation_version_key" ON "performance_accepted_results"("evaluationId", "version");
CREATE INDEX "performance_accepted_results_status_expiry_idx" ON "performance_accepted_results"("status", "expiresAt");

CREATE TABLE "performance_current_level_projections" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "state" "PerformanceProjectionState" NOT NULL,
  "levelCode" TEXT,
  "levelPolicyVersionId" TEXT,
  "sourceResultsHash" TEXT NOT NULL,
  "newestMeasurementTo" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL,
  "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_current_level_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_current_level_projections_subject_fkey" FOREIGN KEY ("subjectId") REFERENCES "performance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_current_level_projections_policy_fkey" FOREIGN KEY ("levelPolicyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_current_level_projections_level_check" CHECK (("state" = 'LEVEL' AND "levelCode" IS NOT NULL AND "levelPolicyVersionId" IS NOT NULL) OR ("state" <> 'LEVEL' AND "levelCode" IS NULL))
);
CREATE UNIQUE INDEX "performance_current_level_projections_subject_key" ON "performance_current_level_projections"("subjectId");
CREATE INDEX "performance_current_level_projections_state_projected_idx" ON "performance_current_level_projections"("state", "projectedAt");

CREATE TABLE "performance_corrections" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "targetResultId" TEXT,
  "version" INTEGER NOT NULL,
  "status" "PerformanceCorrectionStatus" NOT NULL DEFAULT 'OPEN',
  "correctionKind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "encryptedPayloadId" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "performance_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_corrections_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_corrections_result_fkey" FOREIGN KEY ("targetResultId") REFERENCES "performance_accepted_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_corrections_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_corrections_requester_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_corrections_decider_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_corrections_payload_key" ON "performance_corrections"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_corrections_evaluation_version_key" ON "performance_corrections"("evaluationId", "version");
CREATE INDEX "performance_corrections_status_requested_idx" ON "performance_corrections"("status", "requestedAt");

CREATE TABLE "performance_audit_events" (
  "id" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "actorUserId" TEXT,
  "authorityHash" TEXT,
  "reason" TEXT,
  "encryptedPayloadId" TEXT,
  "previousEventHash" TEXT,
  "eventHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_audit_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_audit_events_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_audit_events_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_audit_events_payload_key" ON "performance_audit_events"("encryptedPayloadId");
CREATE UNIQUE INDEX "performance_audit_events_hash_key" ON "performance_audit_events"("eventHash");
CREATE INDEX "performance_audit_events_aggregate_occurred_idx" ON "performance_audit_events"("aggregateType", "aggregateId", "occurredAt");
CREATE INDEX "performance_audit_events_actor_occurred_idx" ON "performance_audit_events"("actorUserId", "occurredAt");

CREATE TABLE "performance_retention_states" (
  "id" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "restrictAt" TIMESTAMP(3),
  "deleteAfter" TIMESTAMP(3),
  "legalHoldCount" INTEGER NOT NULL DEFAULT 0,
  "policyVersionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_retention_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_retention_states_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_retention_states_hold_count_check" CHECK ("legalHoldCount" >= 0)
);
CREATE UNIQUE INDEX "performance_retention_states_aggregate_version_key" ON "performance_retention_states"("aggregateType", "aggregateId", "version");
CREATE INDEX "performance_retention_states_status_delete_idx" ON "performance_retention_states"("status", "deleteAfter");

CREATE TABLE "performance_legal_holds" (
  "id" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "placedByUserId" TEXT NOT NULL,
  "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedByUserId" TEXT,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  CONSTRAINT "performance_legal_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_legal_holds_placer_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_legal_holds_releaser_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_legal_holds_lifecycle_check" CHECK (("status" = 'ACTIVE' AND "releasedAt" IS NULL) OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "releasedByUserId" IS NOT NULL AND "releaseReason" IS NOT NULL))
);
CREATE UNIQUE INDEX "performance_legal_holds_aggregate_version_key" ON "performance_legal_holds"("aggregateType", "aggregateId", "version");
CREATE INDEX "performance_legal_holds_status_placed_idx" ON "performance_legal_holds"("status", "placedAt");

CREATE TABLE "performance_export_receipts" (
  "id" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "exportKind" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "permissionHash" TEXT NOT NULL,
  "status" "PerformanceExportStatus" NOT NULL DEFAULT 'QUEUED',
  "encryptedPayloadId" TEXT,
  "artifactHash" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "performance_export_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_export_receipts_requester_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_export_receipts_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_export_receipts_payload_key" ON "performance_export_receipts"("encryptedPayloadId");
CREATE INDEX "performance_export_receipts_requester_requested_idx" ON "performance_export_receipts"("requestedByUserId", "requestedAt");
CREATE INDEX "performance_export_receipts_status_expires_idx" ON "performance_export_receipts"("status", "expiresAt");

ALTER TABLE "performance_evaluations" ADD CONSTRAINT "performance_evaluations_context_snapshot_fkey" FOREIGN KEY ("contextSnapshotId") REFERENCES "performance_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_evaluations" ADD CONSTRAINT "performance_evaluations_accepted_result_fkey" FOREIGN KEY ("acceptedResultId") REFERENCES "performance_accepted_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_evaluation_sections" ADD CONSTRAINT "performance_evaluation_sections_template_snapshot_fkey" FOREIGN KEY ("templateSnapshotId") REFERENCES "performance_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION performance_reject_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'personnel performance evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performance_encrypted_payloads_append_only BEFORE UPDATE OR DELETE ON "performance_encrypted_payloads" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_snapshots_append_only BEFORE UPDATE OR DELETE ON "performance_snapshots" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_submissions_append_only BEFORE UPDATE OR DELETE ON "performance_submissions" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_reviews_append_only BEFORE UPDATE OR DELETE ON "performance_reviews" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_traces_append_only BEFORE UPDATE OR DELETE ON "performance_calculation_traces" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_results_append_only BEFORE UPDATE OR DELETE ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_audit_append_only BEFORE UPDATE OR DELETE ON "performance_audit_events" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();

-- This additive foundation deliberately performs no score, result, Badge, or
-- cohort backfill. Production activation remains a separately authorized gate.
