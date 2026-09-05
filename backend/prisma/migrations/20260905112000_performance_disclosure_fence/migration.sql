-- A changed evidence revision invalidates queued artifacts; row locks serialize final disclosure decisions.
CREATE TABLE performance_disclosure_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision BIGINT NOT NULL DEFAULT 0
);
INSERT INTO performance_disclosure_revision (id) VALUES (1);
CREATE FUNCTION performance_bump_disclosure_revision() RETURNS trigger AS $$
BEGIN
  UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_evidence_restrictions','performance_legal_holds','performance_accepted_results',
    'performance_corrections','performance_current_level_projections','performance_feature_phase_versions','performance_safety_pauses',
    'performance_cohort_members','performance_subjects','performance_peer_family_versions','performance_peer_family_jobs',
    'performance_privacy_cases'] LOOP
    EXECUTE format('CREATE TRIGGER performance_disclosure_revision BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision()', table_name);
  END LOOP;
END $$;
INSERT INTO hr_feature_catalogs ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-request-performance-privacy-case', 'REQUEST_PERFORMANCE_PRIVACY_CASE', 'HUMAN_RESOURCES', 1,
  'ثبت درخواست حریم خصوصی عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM hr_workspace_catalogs WHERE code = 'HUMAN_RESOURCES')
ON CONFLICT (code) DO NOTHING;
