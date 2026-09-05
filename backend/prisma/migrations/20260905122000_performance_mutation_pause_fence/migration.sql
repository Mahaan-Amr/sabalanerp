CREATE OR REPLACE FUNCTION performance_guard_canonical_write() RETURNS trigger AS $$
DECLARE body JSONB := to_jsonb(NEW); subject_id TEXT; evaluation_id TEXT; section_id TEXT; enabled BOOLEAN;
BEGIN
  -- Updating the shared fence forces a stale Serializable writer to retry rather than overlook a pause.
  UPDATE performance_disclosure_revision SET revision = revision,
    "firstCanonicalWriteAt" = COALESCE("firstCanonicalWriteAt", clock_timestamp()),
    "firstCanonicalTable" = COALESCE("firstCanonicalTable", TG_TABLE_NAME),
    "firstCanonicalIdHash" = COALESCE("firstCanonicalIdHash", encode(sha256(convert_to(body->>'id','UTF8')),'hex')) WHERE id = 1;
  IF TG_TABLE_NAME = 'performance_privacy_cases' THEN RETURN NEW; END IF;
  -- Protective invalidation/suspension/expiry preserves evidence and must remain possible during recovery.
  IF TG_OP = 'UPDATE' AND (
    (TG_TABLE_NAME IN ('performance_evaluations','performance_evaluation_sections') AND body->>'status' = 'INVALIDATED') OR
    (TG_TABLE_NAME = 'performance_accepted_results' AND body->>'status' IN ('SUSPENDED','EXPIRED'))
  ) AND (to_jsonb(NEW) - ARRAY['status','updatedAt','writerVersion']) IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','updatedAt','writerVersion']) THEN RETURN NEW; END IF;
  SELECT "releaseEnabled" INTO enabled FROM performance_feature_phase_versions
    WHERE "effectiveFrom" <= clock_timestamp() ORDER BY "effectiveFrom" DESC, version DESC LIMIT 1;
  IF NOT COALESCE(enabled, false) THEN RAISE EXCEPTION 'PERFORMANCE_RELEASE_DISABLED: canonical mutation denied'; END IF;
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
    'performance_cycles','performance_evaluations','performance_evaluation_sections','performance_drafts','performance_accepted_results'] LOOP
    EXECUTE format('CREATE TRIGGER performance_canonical_update_fence BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION performance_guard_canonical_write()', table_name);
  END LOOP;
END $$;
