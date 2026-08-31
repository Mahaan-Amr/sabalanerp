ALTER TYPE "PerformanceReviewDecision" ADD VALUE IF NOT EXISTS 'EXTENDED';
ALTER TYPE "PerformanceReviewDecision" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "PerformanceReviewDecision" ADD VALUE IF NOT EXISTS 'INVALIDATED';
ALTER TYPE "PerformanceReviewDecision" ADD VALUE IF NOT EXISTS 'CORRECTION_STARTED';
CREATE TYPE "PerformanceReviewStatus" AS ENUM ('CLAIMED', 'DECIDED');
CREATE TYPE "PerformanceTemplateKind" AS ENUM ('JOB_TEMPLATE', 'POSITION_ADDENDUM');

CREATE TABLE "performance_deletion_receipts" (
  "id" TEXT NOT NULL,
  "deletedTableName" TEXT NOT NULL,
  "deletedRecordId" TEXT NOT NULL,
  "deletedPayloadId" TEXT,
  "aggregateType" TEXT NOT NULL,
  "aggregateIdHash" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "dependencyEffectHash" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "authorityHash" TEXT NOT NULL,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_deletion_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_deletion_receipts_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_deletion_receipts_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_deletion_receipts_count_check" CHECK ("recordCount" > 0)
);
CREATE UNIQUE INDEX "performance_deletion_receipts_table_record_key" ON "performance_deletion_receipts"("deletedTableName", "deletedRecordId");
CREATE UNIQUE INDEX "performance_deletion_receipts_payload_key" ON "performance_deletion_receipts"("deletedPayloadId");
CREATE INDEX "performance_deletion_receipts_aggregate_executed_idx" ON "performance_deletion_receipts"("aggregateType", "executedAt");

ALTER TABLE "performance_subjects" DROP CONSTRAINT "performance_subjects_personnel_fkey";
ALTER TABLE "performance_subjects" DROP CONSTRAINT "performance_subjects_relationship_fkey";
ALTER TABLE "performance_subjects" ALTER COLUMN "personnelId" DROP NOT NULL;
ALTER TABLE "performance_subjects" ALTER COLUMN "employmentRelationshipId" DROP NOT NULL;
ALTER TABLE "performance_subjects" ADD COLUMN "identityDetachedAt" TIMESTAMP(3);
ALTER TABLE "performance_subjects" ADD COLUMN "identityDetachedByUserId" TEXT;
ALTER TABLE "performance_subjects" ADD COLUMN "identityDetachmentReceiptId" TEXT;
CREATE UNIQUE INDEX "hr_employment_relationships_id_personnel_key" ON "hr_employment_relationships"("id", "personnelId");
CREATE UNIQUE INDEX "performance_subjects_identity_receipt_key" ON "performance_subjects"("identityDetachmentReceiptId");
ALTER TABLE "performance_subjects" ADD CONSTRAINT "performance_subjects_identity_match_fkey" FOREIGN KEY ("employmentRelationshipId", "personnelId") REFERENCES "hr_employment_relationships"("id", "personnelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_subjects" ADD CONSTRAINT "performance_subjects_detachment_actor_fkey" FOREIGN KEY ("identityDetachedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_subjects" ADD CONSTRAINT "performance_subjects_detachment_receipt_fkey" FOREIGN KEY ("identityDetachmentReceiptId") REFERENCES "performance_deletion_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_subjects" ADD CONSTRAINT "performance_subjects_identity_state_check" CHECK (
  ("personnelId" IS NOT NULL AND "employmentRelationshipId" IS NOT NULL AND "identityDetachedAt" IS NULL AND "identityDetachedByUserId" IS NULL AND "identityDetachmentReceiptId" IS NULL)
  OR
  ("personnelId" IS NULL AND "employmentRelationshipId" IS NULL AND "identityDetachedAt" IS NOT NULL AND "identityDetachedByUserId" IS NOT NULL AND "identityDetachmentReceiptId" IS NOT NULL)
);

ALTER TABLE "performance_template_versions" ALTER COLUMN "templateKind" TYPE "PerformanceTemplateKind" USING "templateKind"::"PerformanceTemplateKind";
ALTER TABLE "performance_template_versions" ADD CONSTRAINT "performance_template_versions_owner_type_check" CHECK (
  ("templateKind" = 'JOB_TEMPLATE' AND "ownerType" = 'JOB') OR
  ("templateKind" = 'POSITION_ADDENDUM' AND "ownerType" = 'POSITION')
);

CREATE UNIQUE INDEX "performance_policy_versions_id_kind_key" ON "performance_policy_versions"("id", "policyKind");
ALTER TABLE "performance_policy_versions" ADD CONSTRAINT "performance_policy_versions_predecessor_kind_fkey" FOREIGN KEY ("predecessorId", "policyKind") REFERENCES "performance_policy_versions"("id", "policyKind") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_policy_versions" ADD CONSTRAINT "performance_policy_versions_effective_check" CHECK ("lifecycle" NOT IN ('SCHEDULED', 'ACTIVE') OR "effectiveFrom" IS NOT NULL);

CREATE UNIQUE INDEX "performance_criterion_versions_id_identity_key" ON "performance_criterion_versions"("id", "criterionIdentityId");
ALTER TABLE "performance_criterion_versions" ADD CONSTRAINT "performance_criterion_versions_predecessor_identity_fkey" FOREIGN KEY ("predecessorId", "criterionIdentityId") REFERENCES "performance_criterion_versions"("id", "criterionIdentityId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_criterion_versions" ADD CONSTRAINT "performance_criterion_versions_effective_check" CHECK ("lifecycle" NOT IN ('SCHEDULED', 'ACTIVE') OR "effectiveFrom" IS NOT NULL);

CREATE UNIQUE INDEX "performance_template_versions_id_owner_key" ON "performance_template_versions"("id", "templateKind", "ownerType", "ownerId");
ALTER TABLE "performance_template_versions" ADD CONSTRAINT "performance_template_versions_predecessor_owner_fkey" FOREIGN KEY ("predecessorId", "templateKind", "ownerType", "ownerId") REFERENCES "performance_template_versions"("id", "templateKind", "ownerType", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_template_versions" ADD CONSTRAINT "performance_template_versions_effective_check" CHECK ("lifecycle" NOT IN ('SCHEDULED', 'ACTIVE') OR "effectiveFrom" IS NOT NULL);

ALTER TABLE "performance_cohort_versions" ADD CONSTRAINT "performance_cohort_versions_activation_check" CHECK (
  "lifecycle" = 'DRAFT' OR ("effectiveFrom" IS NOT NULL AND "activationReason" IS NOT NULL AND "activatedByUserId" IS NOT NULL)
);

CREATE UNIQUE INDEX "users_id_personnel_key" ON "users"("id", "personnelId");
CREATE UNIQUE INDEX "performance_sections_id_supervisor_key" ON "performance_evaluation_sections"("id", "responsibleSupervisorPersonnelId");
ALTER TABLE "performance_drafts" ADD COLUMN "supervisorPersonnelId" TEXT NOT NULL;
ALTER TABLE "performance_drafts" ADD CONSTRAINT "performance_drafts_user_personnel_fkey" FOREIGN KEY ("supervisorUserId", "supervisorPersonnelId") REFERENCES "users"("id", "personnelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_drafts" ADD CONSTRAINT "performance_drafts_section_supervisor_fkey" FOREIGN KEY ("sectionId", "supervisorPersonnelId") REFERENCES "performance_evaluation_sections"("id", "responsibleSupervisorPersonnelId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "performance_drafts_one_open_writer" ON "performance_drafts"("sectionId", "supervisorUserId") WHERE "status" = 'OPEN';

ALTER TABLE "performance_submissions" ADD COLUMN "supervisorPersonnelId" TEXT NOT NULL;
ALTER TABLE "performance_submissions" ADD CONSTRAINT "performance_submissions_user_personnel_fkey" FOREIGN KEY ("supervisorUserId", "supervisorPersonnelId") REFERENCES "users"("id", "personnelId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_submissions" ADD CONSTRAINT "performance_submissions_section_supervisor_fkey" FOREIGN KEY ("sectionId", "supervisorPersonnelId") REFERENCES "performance_evaluation_sections"("id", "responsibleSupervisorPersonnelId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "performance_snapshots_id_evaluation_key" ON "performance_snapshots"("id", "evaluationId");
CREATE UNIQUE INDEX "performance_snapshots_id_section_evaluation_key" ON "performance_snapshots"("id", "sectionId", "evaluationId");
CREATE UNIQUE INDEX "performance_results_id_evaluation_key" ON "performance_accepted_results"("id", "evaluationId");
ALTER TABLE "performance_evaluations" DROP CONSTRAINT "performance_evaluations_context_snapshot_fkey";
ALTER TABLE "performance_evaluations" DROP CONSTRAINT "performance_evaluations_accepted_result_fkey";
ALTER TABLE "performance_evaluations" ADD CONSTRAINT "performance_evaluations_context_snapshot_lineage_fkey" FOREIGN KEY ("contextSnapshotId", "id") REFERENCES "performance_snapshots"("id", "evaluationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_evaluations" ADD CONSTRAINT "performance_evaluations_accepted_result_lineage_fkey" FOREIGN KEY ("acceptedResultId", "id") REFERENCES "performance_accepted_results"("id", "evaluationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_evaluation_sections" DROP CONSTRAINT "performance_evaluation_sections_template_snapshot_fkey";
ALTER TABLE "performance_evaluation_sections" ADD CONSTRAINT "performance_sections_template_snapshot_lineage_fkey" FOREIGN KEY ("templateSnapshotId", "id", "evaluationId") REFERENCES "performance_snapshots"("id", "sectionId", "evaluationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_accepted_results" DROP CONSTRAINT "performance_accepted_results_supersedes_fkey";
ALTER TABLE "performance_accepted_results" ADD CONSTRAINT "performance_results_supersedes_lineage_fkey" FOREIGN KEY ("supersedesResultId", "evaluationId") REFERENCES "performance_accepted_results"("id", "evaluationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance_reviews" ALTER COLUMN "decision" DROP NOT NULL;
ALTER TABLE "performance_reviews" ALTER COLUMN "decidedAt" DROP NOT NULL;
ALTER TABLE "performance_reviews" ALTER COLUMN "decidedAt" DROP DEFAULT;
ALTER TABLE "performance_reviews" ALTER COLUMN "claimedAt" SET NOT NULL;
ALTER TABLE "performance_reviews" ALTER COLUMN "claimedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "performance_reviews" ADD COLUMN "status" "PerformanceReviewStatus" NOT NULL DEFAULT 'CLAIMED';
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_state_check" CHECK (
  ("status" = 'CLAIMED' AND "decision" IS NULL AND "decidedAt" IS NULL)
  OR
  ("status" = 'DECIDED' AND "decision" IS NOT NULL AND "decidedAt" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION performance_reject_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'personnel performance evidence is append-only';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "performance_deletion_receipts"
    WHERE "deletedTableName" = TG_TABLE_NAME AND "deletedRecordId" = OLD."id"
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'personnel performance evidence deletion requires a deletion receipt';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION performance_reject_receipt_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'personnel performance deletion receipt is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_deletion_receipts_append_only BEFORE UPDATE OR DELETE ON "performance_deletion_receipts" FOR EACH ROW EXECUTE FUNCTION performance_reject_receipt_mutation();

CREATE OR REPLACE FUNCTION performance_guard_version_mutation()
RETURNS trigger AS $$
DECLARE
  old_state TEXT := OLD."lifecycle"::TEXT;
  new_state TEXT := NEW."lifecycle"::TEXT;
  immutable_old JSONB;
  immutable_new JSONB;
BEGIN
  IF old_state = new_state AND old_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'published performance version is immutable';
  END IF;
  IF old_state <> new_state AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'ACTIVE', 'CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state IN ('ACTIVE', 'CANCELLED')) OR
    (old_state = 'ACTIVE' AND new_state = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid performance version lifecycle transition';
  END IF;
  IF old_state <> 'DRAFT' THEN
    immutable_old := to_jsonb(OLD) - 'lifecycle' - 'retiredAt';
    immutable_new := to_jsonb(NEW) - 'lifecycle' - 'retiredAt';
    IF immutable_old IS DISTINCT FROM immutable_new THEN
      RAISE EXCEPTION 'published performance version is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_policy_versions_guard BEFORE UPDATE ON "performance_policy_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_criterion_versions_guard BEFORE UPDATE ON "performance_criterion_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_template_versions_guard BEFORE UPDATE ON "performance_template_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_cohort_versions_guard BEFORE UPDATE ON "performance_cohort_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
