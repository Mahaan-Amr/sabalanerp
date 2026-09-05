CREATE FUNCTION performance_guard_cohort_membership() RETURNS trigger AS $$
DECLARE cohort_id TEXT;
BEGIN
  cohort_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."cohortVersionId" ELSE NEW."cohortVersionId" END;
  PERFORM 1 FROM performance_cohort_versions WHERE id = cohort_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM performance_cohort_versions WHERE id = cohort_id AND lifecycle = 'DRAFT') THEN
    RAISE EXCEPTION 'PERFORMANCE_COHORT_MEMBERSHIP_FROZEN';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."cohortVersionId" IS DISTINCT FROM OLD."cohortVersionId" THEN
    RAISE EXCEPTION 'PERFORMANCE_COHORT_MEMBERSHIP_IDENTITY_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_cohort_membership_guard BEFORE INSERT OR UPDATE OR DELETE ON performance_cohort_members
FOR EACH ROW EXECUTE FUNCTION performance_guard_cohort_membership();
