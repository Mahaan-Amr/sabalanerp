CREATE TABLE performance_privacy_corrections (
  id TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES performance_privacy_cases(id) ON DELETE RESTRICT,
  "evaluationId" TEXT NOT NULL REFERENCES performance_evaluations(id) ON DELETE RESTRICT,
  "correctionId" TEXT NOT NULL REFERENCES performance_corrections(id) ON DELETE RESTRICT,
  UNIQUE ("caseId", "evaluationId")
);
CREATE TRIGGER performance_privacy_correction_immutable BEFORE UPDATE OR DELETE ON performance_privacy_corrections FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE FUNCTION performance_guard_privacy_correction_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM performance_privacy_scopes scope JOIN performance_corrections correction ON correction."evaluationId" = scope."evaluationId"
    JOIN performance_privacy_cases c ON c.id = scope."caseId" WHERE scope."caseId" = NEW."caseId" AND scope."evaluationId" = NEW."evaluationId"
    AND correction.id = NEW."correctionId" AND c."requestKind" = 'CORRECTION' AND c.status = 'VERIFIED') THEN RAISE EXCEPTION 'privacy correction must match verified scope'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_privacy_correction_scope BEFORE INSERT ON performance_privacy_corrections FOR EACH ROW EXECUTE FUNCTION performance_guard_privacy_correction_scope();
INSERT INTO hr_feature_catalogs ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-register-performance-correction','REGISTER_PERFORMANCE_CORRECTION','HUMAN_RESOURCES',1,'ثبت اصلاح نسخه‌دار عملکرد',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM hr_workspace_catalogs WHERE code = 'HUMAN_RESOURCES') ON CONFLICT (code) DO NOTHING;
