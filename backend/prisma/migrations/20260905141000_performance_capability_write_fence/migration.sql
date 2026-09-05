CREATE FUNCTION performance_guard_capability_write() RETURNS trigger AS $$
DECLARE
  current_phase TEXT;
  enabled BOOLEAN;
  required_phase TEXT;
  phases TEXT[] := ARRAY['SCHEMA_PROTECTION','POLICY_DARK_LAUNCH','READINESS','SUPERVISOR_HR_PILOT',
    'RESULT_LEVEL_BADGE','ANALYTICS_RANKING_CALIBRATION','PDF_EXCEL_EXPORT','CONSEQUENCE_HANDOFF','EXPANSION_RETIREMENT'];
BEGIN
  PERFORM 1 FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERFORMANCE_OPERATIONS_FENCE_UNAVAILABLE'; END IF;
  IF TG_OP = 'UPDATE' AND (
    (TG_TABLE_NAME IN ('performance_evaluations','performance_evaluation_sections') AND NEW.status::TEXT = 'INVALIDATED') OR
    (TG_TABLE_NAME = 'performance_accepted_results' AND NEW.status::TEXT IN ('SUSPENDED','EXPIRED'))
  ) AND (to_jsonb(NEW) - ARRAY['status','updatedAt','writerVersion']) IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','updatedAt','writerVersion']) THEN RETURN NEW; END IF;
  required_phase := CASE
    WHEN TG_TABLE_NAME IN ('performance_policy_versions','performance_criterion_versions','performance_template_versions') THEN 'POLICY_DARK_LAUNCH'
    WHEN TG_TABLE_NAME IN ('performance_cycles','performance_evaluations','performance_evaluation_sections') THEN 'READINESS'
    WHEN TG_TABLE_NAME IN ('performance_drafts','performance_submissions','performance_reviews','performance_review_claims','performance_accepted_results') THEN 'SUPERVISOR_HR_PILOT'
    WHEN TG_TABLE_NAME = 'performance_export_receipts' THEN 'PDF_EXCEL_EXPORT'
    WHEN TG_TABLE_NAME = 'performance_consequence_handoffs' THEN 'CONSEQUENCE_HANDOFF'
  END;
  SELECT phase::TEXT, "releaseEnabled" INTO current_phase, enabled FROM performance_feature_phase_versions
    WHERE "effectiveFrom" <= clock_timestamp() ORDER BY "effectiveFrom" DESC, version DESC LIMIT 1;
  IF NOT COALESCE(enabled, false) THEN RAISE EXCEPTION 'PERFORMANCE_RELEASE_DISABLED'; END IF;
  IF required_phase IS NULL OR array_position(phases, current_phase) IS NULL
    OR array_position(phases, current_phase) < array_position(phases, required_phase) THEN
    RAISE EXCEPTION 'PERFORMANCE_CAPABILITY_NOT_ACTIVE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE target_table TEXT; BEGIN
  FOREACH target_table IN ARRAY ARRAY['performance_policy_versions','performance_criterion_versions','performance_template_versions',
    'performance_cycles','performance_evaluations','performance_evaluation_sections','performance_drafts','performance_submissions',
    'performance_reviews','performance_review_claims','performance_accepted_results','performance_export_receipts','performance_consequence_handoffs'] LOOP
    EXECUTE format('CREATE TRIGGER performance_capability_insert_fence BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION performance_guard_capability_write()', target_table);
  END LOOP;
  -- Cleanup, claim expiry and handoff suspension remain available during recovery.
  FOREACH target_table IN ARRAY ARRAY['performance_policy_versions','performance_criterion_versions','performance_template_versions',
    'performance_cycles','performance_evaluations','performance_evaluation_sections','performance_drafts','performance_accepted_results'] LOOP
    EXECUTE format('CREATE TRIGGER performance_capability_update_fence BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION performance_guard_capability_write()', target_table);
  END LOOP;
END $$;
