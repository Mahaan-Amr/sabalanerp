CREATE TYPE "PerformanceCycleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED', 'CANCELLED');
CREATE TYPE "PerformanceDraftStatus" AS ENUM ('OPEN', 'SUBMITTED', 'DISCARDED');
ALTER TABLE "performance_cycles" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "performance_cycles" ALTER COLUMN "status" TYPE "PerformanceCycleStatus" USING "status"::"PerformanceCycleStatus";
ALTER TABLE "performance_cycles" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP INDEX "performance_drafts_one_open_writer";
ALTER TABLE "performance_drafts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "performance_drafts" ALTER COLUMN "status" TYPE "PerformanceDraftStatus" USING "status"::"PerformanceDraftStatus";
ALTER TABLE "performance_drafts" ALTER COLUMN "status" SET DEFAULT 'OPEN';
CREATE UNIQUE INDEX "performance_drafts_one_open_writer" ON "performance_drafts"("sectionId", "supervisorUserId") WHERE "status" = 'OPEN';

DROP INDEX "performance_reviews_submission_version_key";
CREATE UNIQUE INDEX "performance_reviews_submission_key" ON "performance_reviews"("submissionId");

DROP INDEX "performance_review_claims_submission_key";
CREATE INDEX "performance_review_claims_submission_expiry_idx" ON "performance_review_claims"("submissionId", "expiresAt");
ALTER TABLE "performance_review_claims" ADD CONSTRAINT "performance_review_claims_no_overlap"
EXCLUDE USING gist (
  "submissionId" WITH =,
  tsrange("claimedAt", "expiresAt", '[)') WITH &&
)
WHERE ("releasedAt" IS NULL);

ALTER TABLE "performance_policy_versions" ADD COLUMN "activationPreviewHash" TEXT;
ALTER TABLE "performance_policy_versions" ADD COLUMN "activationConfirmedAt" TIMESTAMP(3);
ALTER TABLE "performance_policy_versions" ADD CONSTRAINT "performance_policy_versions_activation_evidence_check" CHECK (
  "lifecycle" = 'DRAFT'
  OR (
    "activationPreviewHash" IS NOT NULL
    AND "activationConfirmedAt" IS NOT NULL
    AND "publishedAt" IS NOT NULL
    AND "effectiveFrom" >= "publishedAt"
    AND "activationConfirmedAt" <= "publishedAt"
  )
);

CREATE OR REPLACE FUNCTION performance_guard_version_mutation()
RETURNS trigger AS $$
DECLARE
  old_state TEXT;
  new_state TEXT := NEW."lifecycle"::TEXT;
  immutable_old JSONB;
  immutable_new JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN
      RAISE EXCEPTION 'performance versions must begin as drafts';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."lifecycle"::TEXT;
  IF old_state = new_state AND old_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'published performance version is immutable';
  END IF;
  IF old_state <> new_state AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state = 'ACTIVE') OR
    (old_state = 'ACTIVE' AND new_state = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid performance version lifecycle transition';
  END IF;
  IF old_state = 'SCHEDULED' AND new_state = 'ACTIVE' AND NEW."effectiveFrom" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'performance version cannot activate before its effective time';
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

CREATE TRIGGER performance_policy_versions_initial_guard BEFORE INSERT ON "performance_policy_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_criterion_versions_initial_guard BEFORE INSERT ON "performance_criterion_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_template_versions_initial_guard BEFORE INSERT ON "performance_template_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();
CREATE TRIGGER performance_cohort_versions_initial_guard BEFORE INSERT ON "performance_cohort_versions" FOR EACH ROW EXECUTE FUNCTION performance_guard_version_mutation();

CREATE OR REPLACE FUNCTION performance_guard_version_lineage()
RETURNS trigger AS $$
DECLARE predecessor_version INTEGER;
BEGIN
  IF NEW."version" < 1 THEN
    RAISE EXCEPTION 'performance version must be positive';
  END IF;
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

CREATE OR REPLACE FUNCTION performance_guard_result_lineage()
RETURNS trigger AS $$
DECLARE predecessor_version INTEGER;
BEGIN
  IF NEW."version" < 1 THEN
    RAISE EXCEPTION 'accepted performance result version must be positive';
  END IF;
  IF NEW."version" = 1 AND NEW."supersedesResultId" IS NOT NULL THEN
    RAISE EXCEPTION 'first accepted performance result cannot supersede another result';
  END IF;
  IF NEW."version" > 1 AND NEW."supersedesResultId" IS NULL THEN
    RAISE EXCEPTION 'accepted performance result requires its immediate predecessor';
  END IF;
  IF NEW."supersedesResultId" IS NOT NULL THEN
    SELECT "version" INTO predecessor_version FROM "performance_accepted_results"
    WHERE "id" = NEW."supersedesResultId" AND "evaluationId" = NEW."evaluationId";
    IF predecessor_version IS NULL OR predecessor_version <> NEW."version" - 1 THEN
      RAISE EXCEPTION 'accepted performance result must supersede the immediately previous version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_results_lineage_guard BEFORE INSERT OR UPDATE OF "supersedesResultId", "version" ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_guard_result_lineage();
CREATE UNIQUE INDEX "performance_results_one_effective_evaluation" ON "performance_accepted_results"("evaluationId") WHERE "status" = 'EFFECTIVE';

CREATE OR REPLACE FUNCTION performance_guard_operational_lifecycle()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT;
BEGIN
  new_state := NEW."status"::TEXT;
  IF TG_OP = 'INSERT' THEN
    IF (TG_TABLE_NAME IN ('performance_evaluations', 'performance_evaluation_sections', 'performance_cycles') AND new_state <> 'DRAFT')
      OR (TG_TABLE_NAME = 'performance_drafts' AND new_state <> 'OPEN')
      OR (TG_TABLE_NAME = 'performance_accepted_results' AND new_state <> 'EFFECTIVE')
      OR (TG_TABLE_NAME = 'performance_corrections' AND new_state <> 'OPEN')
      OR (TG_TABLE_NAME IN ('performance_legal_holds', 'performance_safety_pauses') AND new_state <> 'ACTIVE')
      OR (TG_TABLE_NAME = 'performance_export_receipts' AND new_state <> 'QUEUED') THEN
      RAISE EXCEPTION 'invalid initial personnel performance lifecycle state';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."status"::TEXT;
  IF TG_TABLE_NAME = 'performance_accepted_results'
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'accepted performance result evidence is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_cycles' AND old_state <> 'DRAFT'
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'scheduled performance cycle is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_drafts'
    AND ((old_state <> 'OPEN') OR (old_state <> new_state))
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'closed performance draft is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_legal_holds'
    AND (to_jsonb(OLD) - 'status' - 'releasedByUserId' - 'releasedAt' - 'releaseReason')
      IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'releasedByUserId' - 'releasedAt' - 'releaseReason') THEN
    RAISE EXCEPTION 'active legal hold scope is immutable';
  END IF;
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
  IF TG_TABLE_NAME = 'performance_cycles' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED','CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state IN ('ACTIVE','CANCELLED')) OR
    (old_state = 'ACTIVE' AND new_state = 'CLOSED')
  ) THEN RAISE EXCEPTION 'invalid performance cycle lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_drafts' AND NOT (old_state = 'OPEN' AND new_state IN ('SUBMITTED','DISCARDED')) THEN
    RAISE EXCEPTION 'invalid performance draft lifecycle transition';
  END IF;
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

DROP TRIGGER performance_results_lifecycle ON "performance_accepted_results";
CREATE TRIGGER performance_results_lifecycle BEFORE INSERT OR UPDATE ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_cycles_lifecycle BEFORE INSERT OR UPDATE ON "performance_cycles" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_drafts_lifecycle BEFORE INSERT OR UPDATE ON "performance_drafts" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();
CREATE TRIGGER performance_holds_scope_guard BEFORE UPDATE OF "aggregateType", "aggregateId", "aggregateIdHash", "version", "reason", "placedByUserId", "placedAt" ON "performance_legal_holds" FOR EACH ROW EXECUTE FUNCTION performance_guard_operational_lifecycle();

CREATE OR REPLACE FUNCTION performance_guard_review_claim_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."releasedAt" IS NOT NULL OR NEW."releaseReason" IS NOT NULL THEN
      RAISE EXCEPTION 'performance review claim must begin unreleased';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'released performance review claim is immutable';
  END IF;
  IF (to_jsonb(OLD) - 'releasedAt' - 'releaseReason') IS DISTINCT FROM (to_jsonb(NEW) - 'releasedAt' - 'releaseReason')
    OR NEW."releasedAt" IS NULL OR NEW."releaseReason" IS NULL THEN
    RAISE EXCEPTION 'performance review claim may only be explicitly released';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_review_claims_mutation_guard BEFORE INSERT OR UPDATE ON "performance_review_claims" FOR EACH ROW EXECUTE FUNCTION performance_guard_review_claim_mutation();
