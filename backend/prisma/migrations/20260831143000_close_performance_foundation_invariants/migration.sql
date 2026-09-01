CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A review claim is an expiring coordination flag. The decision remains a
-- separate immutable business event.
CREATE TABLE "performance_review_claims" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "reviewerUserId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  CONSTRAINT "performance_review_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_review_claims_submission_fkey" FOREIGN KEY ("submissionId") REFERENCES "performance_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_review_claims_reviewer_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_review_claims_period_check" CHECK ("expiresAt" > "claimedAt"),
  CONSTRAINT "performance_review_claims_release_check" CHECK (
    ("releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "performance_review_claims_submission_key" ON "performance_review_claims"("submissionId");
CREATE INDEX "performance_review_claims_reviewer_expiry_idx" ON "performance_review_claims"("reviewerUserId", "expiresAt");

ALTER TABLE "performance_reviews" DROP CONSTRAINT "performance_reviews_state_check";
ALTER TABLE "performance_reviews" DROP COLUMN "status";
ALTER TABLE "performance_reviews" DROP COLUMN "claimedAt";
ALTER TABLE "performance_reviews" ALTER COLUMN "decision" SET NOT NULL;
ALTER TABLE "performance_reviews" ALTER COLUMN "decidedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "performance_reviews" ALTER COLUMN "decidedAt" SET NOT NULL;
DROP TYPE "PerformanceReviewStatus";

CREATE TYPE "PerformanceReviewDecision_closed" AS ENUM ('ACCEPTED', 'REJECTED', 'NOT_EVALUABLE');
ALTER TABLE "performance_reviews" ALTER COLUMN "decision" TYPE "PerformanceReviewDecision_closed" USING "decision"::TEXT::"PerformanceReviewDecision_closed";
DROP TYPE "PerformanceReviewDecision";
ALTER TYPE "PerformanceReviewDecision_closed" RENAME TO "PerformanceReviewDecision";

-- A receipt may be committed only in the same transaction that completed its
-- deletion/anonymisation. This prevents stale pre-authorisations.
CREATE OR REPLACE FUNCTION performance_verify_deletion_receipt_completion()
RETURNS trigger AS $$
DECLARE
  target_exists BOOLEAN;
BEGIN
  IF NEW."deletedTableName" = 'performance_subjects' AND NEW."reasonCode" = 'AUTHORIZED_IDENTITY_ERASURE' THEN
    SELECT EXISTS (
      SELECT 1 FROM "performance_subjects"
      WHERE "id" = NEW."deletedRecordId" AND "personnelId" IS NULL AND "employmentRelationshipId" IS NULL
    ) INTO target_exists;
    IF NOT target_exists THEN
      RAISE EXCEPTION 'identity erasure receipt requires completed identity detachment';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."deletedTableName" NOT IN (
    'performance_encrypted_payloads', 'performance_snapshots', 'performance_submissions',
    'performance_reviews', 'performance_calculation_traces', 'performance_accepted_results',
    'performance_audit_events'
  ) THEN
    RAISE EXCEPTION 'unsupported personnel performance deletion receipt target';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "id" = $1)', NEW."deletedTableName")
    INTO target_exists USING NEW."deletedRecordId";
  IF target_exists THEN
    RAISE EXCEPTION 'deletion receipt cannot commit before deletion completes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER performance_deletion_receipt_completion
AFTER INSERT ON "performance_deletion_receipts"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION performance_verify_deletion_receipt_completion();

CREATE OR REPLACE FUNCTION performance_guard_evidence_deletion()
RETURNS trigger AS $$
DECLARE
  receipt RECORD;
  expected_hash TEXT;
BEGIN
  IF TG_TABLE_NAME = 'performance_encrypted_payloads' THEN
    expected_hash := encode(digest(OLD."aggregateId", 'sha256'), 'hex');
    SELECT * INTO receipt FROM "performance_deletion_receipts"
    WHERE "deletedTableName" = TG_TABLE_NAME
      AND "deletedRecordId" = OLD."id"
      AND "deletedPayloadId" = OLD."id"
      AND "aggregateType" = OLD."aggregateType"
      AND "aggregateIdHash" = expected_hash;
  ELSE
    expected_hash := encode(digest(OLD."id", 'sha256'), 'hex');
    SELECT * INTO receipt FROM "performance_deletion_receipts"
    WHERE "deletedTableName" = TG_TABLE_NAME
      AND "deletedRecordId" = OLD."id"
      AND "aggregateIdHash" = expected_hash;
  END IF;
  IF receipt."id" IS NULL THEN
    RAISE EXCEPTION 'personnel performance evidence deletion requires a matching deletion receipt';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(receipt."aggregateType" || ':' || expected_hash, 0));
  IF EXISTS (
    SELECT 1 FROM "performance_legal_holds"
    WHERE "aggregateType" = receipt."aggregateType"
      AND "aggregateIdHash" = expected_hash
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'active legal hold blocks personnel performance deletion';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION performance_lock_legal_hold_scope()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."aggregateType" || ':' || NEW."aggregateIdHash", 0));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_legal_holds_scope_lock BEFORE INSERT OR UPDATE ON "performance_legal_holds" FOR EACH ROW EXECUTE FUNCTION performance_lock_legal_hold_scope();

CREATE OR REPLACE FUNCTION performance_guard_identity_detachment()
RETURNS trigger AS $$
DECLARE
  receipt RECORD;
  expected_hash TEXT := encode(digest(OLD."id", 'sha256'), 'hex');
BEGIN
  IF OLD."personnelId" IS NOT NULL AND NEW."personnelId" IS NULL THEN
    SELECT * INTO receipt FROM "performance_deletion_receipts"
    WHERE "id" = NEW."identityDetachmentReceiptId"
      AND "deletedTableName" = TG_TABLE_NAME
      AND "deletedRecordId" = OLD."id"
      AND "aggregateIdHash" = expected_hash
      AND "reasonCode" = 'AUTHORIZED_IDENTITY_ERASURE';
    IF receipt."id" IS NULL THEN
      RAISE EXCEPTION 'identity detachment requires a matching deletion receipt';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(receipt."aggregateType" || ':' || expected_hash, 0));
    IF EXISTS (
      SELECT 1 FROM "performance_legal_holds"
      WHERE "aggregateType" = receipt."aggregateType" AND "aggregateIdHash" = expected_hash AND "status" = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'active legal hold blocks personnel performance identity detachment';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_subjects_identity_detachment_guard BEFORE UPDATE ON "performance_subjects" FOR EACH ROW EXECUTE FUNCTION performance_guard_identity_detachment();

-- Every version chain is linear, local to its owner, and immediately ordered.
CREATE OR REPLACE FUNCTION performance_guard_version_lineage()
RETURNS trigger AS $$
DECLARE predecessor_version INTEGER;
BEGIN
  IF NEW."version" = 1 AND NEW."predecessorId" IS NOT NULL THEN
    RAISE EXCEPTION 'first performance version cannot have a predecessor';
  END IF;
  IF NEW."version" > 1 AND NEW."predecessorId" IS NULL THEN
    RAISE EXCEPTION 'performance version requires its immediate predecessor';
  END IF;
  IF NEW."predecessorId" IS NOT NULL THEN
    EXECUTE format('SELECT "version" FROM %I WHERE "id" = $1', TG_TABLE_NAME)
      INTO predecessor_version USING NEW."predecessorId";
    IF predecessor_version IS NULL OR predecessor_version <> NEW."version" - 1 THEN
      RAISE EXCEPTION 'performance predecessor must be the immediately previous version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_policy_lineage_guard BEFORE INSERT OR UPDATE OF "predecessorId", "version" ON "performance_policy_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_lineage();
CREATE TRIGGER performance_criterion_lineage_guard BEFORE INSERT OR UPDATE OF "predecessorId", "version" ON "performance_criterion_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_lineage();
CREATE TRIGGER performance_template_lineage_guard BEFORE INSERT OR UPDATE OF "predecessorId", "version" ON "performance_template_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_lineage();
CREATE TRIGGER performance_cohort_lineage_guard BEFORE INSERT OR UPDATE OF "predecessorId", "version" ON "performance_cohort_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_lineage();
CREATE TRIGGER performance_phase_lineage_guard BEFORE INSERT OR UPDATE OF "predecessorId", "version" ON "performance_feature_phase_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_lineage();

CREATE OR REPLACE FUNCTION performance_guard_operational_lifecycle()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT;
BEGIN
  new_state := NEW."status"::TEXT;
  IF TG_OP = 'INSERT' THEN
    IF (TG_TABLE_NAME IN ('performance_evaluations', 'performance_evaluation_sections') AND new_state <> 'DRAFT')
      OR (TG_TABLE_NAME = 'performance_accepted_results' AND new_state <> 'EFFECTIVE')
      OR (TG_TABLE_NAME = 'performance_corrections' AND new_state <> 'OPEN')
      OR (TG_TABLE_NAME IN ('performance_legal_holds', 'performance_safety_pauses') AND new_state <> 'ACTIVE')
      OR (TG_TABLE_NAME = 'performance_export_receipts' AND new_state <> 'QUEUED') THEN
      RAISE EXCEPTION 'invalid initial personnel performance lifecycle state';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."status"::TEXT;
  IF old_state = new_state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'performance_evaluations' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('READY_FOR_SUBMISSION','CANCELLED','INVALIDATED')) OR
    (old_state = 'READY_FOR_SUBMISSION' AND new_state IN ('UNDER_REVIEW','CANCELLED','INVALIDATED')) OR
    (old_state = 'UNDER_REVIEW' AND new_state IN ('ACCEPTED','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state = 'ACCEPTED' AND new_state = 'INVALIDATED')
  ) THEN RAISE EXCEPTION 'invalid performance evaluation lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_evaluation_sections' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SUBMITTED','CANCELLED','INVALIDATED')) OR
    (old_state = 'SUBMITTED' AND new_state IN ('REJECTED','ACCEPTED','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state = 'REJECTED' AND new_state = 'DRAFT') OR
    (old_state = 'ACCEPTED' AND new_state = 'INVALIDATED')
  ) THEN RAISE EXCEPTION 'invalid performance section lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_accepted_results' AND NOT (
    old_state = 'EFFECTIVE' AND new_state IN ('SUSPENDED','SUPERSEDED','EXPIRED')
  ) AND NOT (old_state = 'SUSPENDED' AND new_state = 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid accepted performance result lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_corrections' AND NOT (old_state = 'OPEN' AND new_state IN ('ACCEPTED','REJECTED','CANCELLED')) THEN
    RAISE EXCEPTION 'invalid performance correction lifecycle transition';
  END IF;
  IF TG_TABLE_NAME IN ('performance_legal_holds', 'performance_safety_pauses') AND NOT (old_state = 'ACTIVE' AND new_state IN ('RELEASED','RESUMED')) THEN
    RAISE EXCEPTION 'invalid personnel performance hold lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_export_receipts' AND NOT (
    (old_state = 'QUEUED' AND new_state IN ('RUNNING','FAILED')) OR
    (old_state = 'RUNNING' AND new_state IN ('READY','FAILED')) OR
    (old_state = 'READY' AND new_state IN ('DOWNLOADED','EXPIRED','DELETED')) OR
    (old_state = 'DOWNLOADED' AND new_state = 'DELETED') OR
    (old_state = 'EXPIRED' AND new_state = 'DELETED')
  ) THEN RAISE EXCEPTION 'invalid performance export lifecycle transition'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER performance_results_append_only ON "performance_accepted_results";
DROP TRIGGER performance_encrypted_payloads_append_only ON "performance_encrypted_payloads";
DROP TRIGGER performance_snapshots_append_only ON "performance_snapshots";
DROP TRIGGER performance_submissions_append_only ON "performance_submissions";
DROP TRIGGER performance_reviews_append_only ON "performance_reviews";
DROP TRIGGER performance_traces_append_only ON "performance_calculation_traces";
DROP TRIGGER performance_audit_append_only ON "performance_audit_events";

CREATE TRIGGER performance_encrypted_payloads_update_guard BEFORE UPDATE ON "performance_encrypted_payloads" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_encrypted_payloads_delete_guard BEFORE DELETE ON "performance_encrypted_payloads" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_snapshots_update_guard BEFORE UPDATE ON "performance_snapshots" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_snapshots_delete_guard BEFORE DELETE ON "performance_snapshots" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_submissions_update_guard BEFORE UPDATE ON "performance_submissions" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_submissions_delete_guard BEFORE DELETE ON "performance_submissions" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_reviews_update_guard BEFORE UPDATE ON "performance_reviews" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_reviews_delete_guard BEFORE DELETE ON "performance_reviews" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_traces_update_guard BEFORE UPDATE ON "performance_calculation_traces" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_traces_delete_guard BEFORE DELETE ON "performance_calculation_traces" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_results_delete_guard BEFORE DELETE ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_audit_update_guard BEFORE UPDATE ON "performance_audit_events" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_audit_delete_guard BEFORE DELETE ON "performance_audit_events" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();

CREATE TRIGGER performance_evaluations_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_evaluations" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_sections_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_evaluation_sections" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_results_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_corrections_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_corrections" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_holds_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_legal_holds" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_pauses_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_safety_pauses" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_exports_lifecycle BEFORE INSERT OR UPDATE OF "status" ON "performance_export_receipts" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();

CREATE TRIGGER performance_retention_states_append_only BEFORE UPDATE OR DELETE ON "performance_retention_states" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_phase_versions_append_only BEFORE UPDATE OR DELETE ON "performance_feature_phase_versions" FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
