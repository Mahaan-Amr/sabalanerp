CREATE OR REPLACE FUNCTION performance_guard_deletion_receipt()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."aggregateType" || ':' || NEW."aggregateIdHash", 0));
  IF EXISTS (
    SELECT 1 FROM "performance_legal_holds"
    WHERE "aggregateType" = NEW."aggregateType"
      AND "aggregateIdHash" = NEW."aggregateIdHash"
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'active legal hold blocks personnel performance deletion';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

DROP TRIGGER performance_encrypted_payloads_delete_guard ON "performance_encrypted_payloads";
DROP TRIGGER performance_snapshots_delete_guard ON "performance_snapshots";
DROP TRIGGER performance_submissions_delete_guard ON "performance_submissions";
DROP TRIGGER performance_reviews_delete_guard ON "performance_reviews";
DROP TRIGGER performance_traces_delete_guard ON "performance_calculation_traces";
DROP TRIGGER performance_results_delete_guard ON "performance_accepted_results";
DROP TRIGGER performance_audit_delete_guard ON "performance_audit_events";

CREATE TRIGGER performance_encrypted_payloads_delete_guard BEFORE DELETE ON "performance_encrypted_payloads" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_snapshots_delete_guard BEFORE DELETE ON "performance_snapshots" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_submissions_delete_guard BEFORE DELETE ON "performance_submissions" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_reviews_delete_guard BEFORE DELETE ON "performance_reviews" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_traces_delete_guard BEFORE DELETE ON "performance_calculation_traces" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_results_delete_guard BEFORE DELETE ON "performance_accepted_results" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
CREATE TRIGGER performance_audit_delete_guard BEFORE DELETE ON "performance_audit_events" FOR EACH ROW EXECUTE FUNCTION performance_guard_evidence_deletion();
