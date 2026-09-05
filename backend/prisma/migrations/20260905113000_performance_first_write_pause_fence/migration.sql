ALTER TABLE performance_disclosure_revision ADD COLUMN "firstCanonicalWriteAt" TIMESTAMP(3);
ALTER TABLE performance_disclosure_revision ADD COLUMN "firstCanonicalTable" TEXT;
ALTER TABLE performance_disclosure_revision ADD COLUMN "firstCanonicalIdHash" TEXT;
-- Preserve evidence of existing canonical writes when installing the fence into an existing database.
DO $$ DECLARE item RECORD; earliest TIMESTAMP; earliest_table TEXT; earliest_id TEXT; candidate RECORD;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('performance_policy_versions','createdAt'), ('performance_criterion_versions','createdAt'),
    ('performance_template_versions','createdAt'), ('performance_cycles','createdAt'),
    ('performance_evaluations','createdAt'), ('performance_drafts','createdAt'),
    ('performance_submissions','submittedAt'), ('performance_reviews','decidedAt'),
    ('performance_accepted_results','acceptedAt'), ('performance_export_receipts','requestedAt'),
    ('performance_consequence_handoffs','createdAt'), ('performance_privacy_cases','requestedAt')
  ) AS source(table_name, time_column) LOOP
    EXECUTE format('SELECT "id", %I AS at FROM %I ORDER BY %I ASC LIMIT 1', item.time_column, item.table_name, item.time_column) INTO candidate;
    IF candidate.at IS NOT NULL AND (earliest IS NULL OR candidate.at < earliest) THEN
      earliest := candidate.at; earliest_table := item.table_name; earliest_id := candidate.id;
    END IF;
  END LOOP;
  UPDATE performance_disclosure_revision SET "firstCanonicalWriteAt" = earliest, "firstCanonicalTable" = earliest_table,
    "firstCanonicalIdHash" = CASE WHEN earliest_id IS NULL THEN NULL ELSE encode(sha256(convert_to(earliest_id,'UTF8')),'hex') END WHERE id = 1;
END $$;
CREATE FUNCTION performance_guard_canonical_write() RETURNS trigger AS $$
DECLARE body JSONB := to_jsonb(NEW); subject_id TEXT; evaluation_id TEXT; section_id TEXT;
BEGIN
  -- Updating the shared fence forces a stale Serializable writer to retry rather than overlook a pause.
  UPDATE performance_disclosure_revision SET revision = revision + 1,
    "firstCanonicalWriteAt" = COALESCE("firstCanonicalWriteAt", clock_timestamp()),
    "firstCanonicalTable" = COALESCE("firstCanonicalTable", TG_TABLE_NAME),
    "firstCanonicalIdHash" = COALESCE("firstCanonicalIdHash", encode(sha256(convert_to(body->>'id','UTF8')),'hex')) WHERE id = 1;
  IF TG_TABLE_NAME = 'performance_privacy_cases' THEN RETURN NEW; END IF;
  subject_id := body->>'subjectId'; evaluation_id := body->>'evaluationId'; section_id := body->>'sectionId';
  IF TG_TABLE_NAME = 'performance_evaluations' THEN evaluation_id := body->>'id'; END IF;
  IF section_id IS NULL AND body->>'submissionId' IS NOT NULL THEN
    SELECT "sectionId" INTO section_id FROM performance_submissions WHERE id = body->>'submissionId';
  END IF;
  IF evaluation_id IS NULL AND section_id IS NOT NULL THEN
    SELECT "evaluationId" INTO evaluation_id FROM performance_evaluation_sections WHERE id = section_id;
  END IF;
  IF subject_id IS NULL AND evaluation_id IS NOT NULL THEN
    SELECT "subjectId" INTO subject_id FROM performance_evaluations WHERE id = evaluation_id;
  END IF;
  IF EXISTS (SELECT 1 FROM performance_safety_pauses pause WHERE pause.status = 'ACTIVE' AND
    (subject_id IS NULL OR pause.scope = 'ALL' OR EXISTS (SELECT 1 FROM performance_cohort_members member
      WHERE member."cohortVersionId" = pause."cohortVersionId" AND member."subjectId" = subject_id))) THEN
    RAISE EXCEPTION 'PERFORMANCE_SAFETY_PAUSED: canonical mutation denied';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_policy_versions','performance_criterion_versions','performance_template_versions',
    'performance_cycles','performance_evaluations','performance_drafts','performance_submissions','performance_reviews',
    'performance_accepted_results','performance_export_receipts','performance_consequence_handoffs','performance_privacy_cases'] LOOP
    EXECUTE format('CREATE TRIGGER performance_canonical_write_fence BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION performance_guard_canonical_write()', table_name);
  END LOOP;
END $$;
CREATE FUNCTION performance_guard_compatible_disablement() RETURNS trigger AS $$
DECLARE first_write TIMESTAMP; previous_phase "PerformanceRolloutPhase";
BEGIN
  SELECT "firstCanonicalWriteAt" INTO first_write FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE;
  SELECT phase INTO previous_phase FROM performance_feature_phase_versions ORDER BY version DESC LIMIT 1;
  IF first_write IS NOT NULL AND (NOT NEW."releaseEnabled" OR NEW.phase < previous_phase) THEN
    RAISE EXCEPTION 'PERFORMANCE_FIX_FORWARD_REQUIRED: canonical evidence forbids release disablement or phase downgrade';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_phase_disable_fence BEFORE INSERT ON performance_feature_phase_versions FOR EACH ROW EXECUTE FUNCTION performance_guard_compatible_disablement();
CREATE FUNCTION performance_preserve_first_write() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'canonical first-write evidence is permanent'; END IF;
  IF OLD."firstCanonicalWriteAt" IS NOT NULL AND (NEW."firstCanonicalWriteAt" IS DISTINCT FROM OLD."firstCanonicalWriteAt"
    OR NEW."firstCanonicalTable" IS DISTINCT FROM OLD."firstCanonicalTable" OR NEW."firstCanonicalIdHash" IS DISTINCT FROM OLD."firstCanonicalIdHash") THEN
    RAISE EXCEPTION 'canonical first-write evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_first_write_guard BEFORE UPDATE OR DELETE ON performance_disclosure_revision FOR EACH ROW EXECUTE FUNCTION performance_preserve_first_write();
