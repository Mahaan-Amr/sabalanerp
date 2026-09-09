CREATE FUNCTION performance_require_authenticated_promotion_transaction()
RETURNS trigger AS $$
DECLARE expected_hash TEXT;
DECLARE authenticated_hash TEXT;
BEGIN
  IF NEW."lifecycle" IN ('SCHEDULED','ACTIVE') AND OLD."lifecycle" IN ('DRAFT','SCHEDULED') AND NEW."stage" IS NOT NULL THEN
    SELECT "evidenceHash" INTO expected_hash
    FROM "performance_promotion_evidence"
    WHERE "id" = NEW."promotionEvidenceId";
    authenticated_hash := current_setting('sabalan.performance_promotion_evidence_hash', true);
    IF expected_hash IS NULL OR authenticated_hash IS NULL OR authenticated_hash <> expected_hash THEN
      RAISE EXCEPTION 'performance promotion evidence was not authenticated in the current transaction';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performance_cohort_authenticated_promotion_guard
  BEFORE UPDATE ON "performance_cohort_versions"
  FOR EACH ROW EXECUTE FUNCTION performance_require_authenticated_promotion_transaction();
