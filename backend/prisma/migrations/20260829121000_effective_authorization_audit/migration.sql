BEGIN;
CREATE TABLE effective_authorization_audit (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL, "actorId" TEXT NOT NULL, action TEXT NOT NULL,
  "rootKind" TEXT NOT NULL, "rootId" TEXT NOT NULL, purpose TEXT NOT NULL, channel TEXT NOT NULL,
  allowed BOOLEAN NOT NULL, "isAdmin" BOOLEAN NOT NULL,
  code TEXT NOT NULL, scope TEXT, reason TEXT,
  "correlationId" TEXT NOT NULL CHECK (length(btrim("correlationId")) BETWEEN 1 AND 200),
  "authorizationRevision" INTEGER, "lifecycleRevision" INTEGER, "assignmentId" TEXT, "assignmentRevision" INTEGER,
  "evaluatedAt" TIMESTAMP(3) NOT NULL, "evaluatedGrantIds" JSONB NOT NULL CHECK (jsonb_typeof("evaluatedGrantIds") = 'array'),
  "recordedAt" TIMESTAMP(6) NOT NULL DEFAULT clock_timestamp(),
  CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 2000)
);
CREATE INDEX effective_authorization_audit_root_idx ON effective_authorization_audit (domain, "rootKind", "rootId", "recordedAt");
CREATE FUNCTION effective_authorization_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Authorization evidence is immutable'; END $$;
CREATE TRIGGER effective_authorization_audit_guard BEFORE UPDATE OR DELETE ON effective_authorization_audit
  FOR EACH ROW EXECUTE FUNCTION effective_authorization_evidence_guard();
CREATE TRIGGER effective_authorization_audit_truncate_guard BEFORE TRUNCATE ON effective_authorization_audit
  FOR EACH STATEMENT EXECUTE FUNCTION effective_authorization_evidence_guard();
CREATE TRIGGER effective_authorization_state_guard BEFORE DELETE ON effective_authorization_state
  FOR EACH ROW EXECUTE FUNCTION effective_authorization_evidence_guard();
CREATE TRIGGER effective_authorization_state_truncate_guard BEFORE TRUNCATE ON effective_authorization_state
  FOR EACH STATEMENT EXECUTE FUNCTION effective_authorization_evidence_guard();
COMMIT;
