CREATE TABLE performance_export_cleanup_attempts (
  id TEXT PRIMARY KEY,
  "exportId" TEXT NOT NULL UNIQUE REFERENCES performance_export_receipts(id) ON DELETE RESTRICT,
  "policyVersionId" TEXT NOT NULL REFERENCES performance_policy_versions(id) ON DELETE RESTRICT,
  "artifactHash" TEXT,
  "scopeHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RETRY_REQUIRED','HELD','LIVE_DELETED_PENDING_BACKUP')),
  "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount" >= 0),
  "lastFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "liveDeletedAt" TIMESTAMP(3),
  CHECK ((status = 'LIVE_DELETED_PENDING_BACKUP') = ("liveDeletedAt" IS NOT NULL))
);
CREATE INDEX performance_cleanup_attempts_retry ON performance_export_cleanup_attempts(status, "updatedAt");
CREATE FUNCTION performance_guard_cleanup_journal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'cleanup journal must preserve retry evidence'; END IF;
  IF OLD.status = 'LIVE_DELETED_PENDING_BACKUP' OR
    (to_jsonb(NEW) - ARRAY['status','attemptCount','lastFailureCode','updatedAt','liveDeletedAt']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','attemptCount','lastFailureCode','updatedAt','liveDeletedAt']) OR NEW."attemptCount" < OLD."attemptCount" THEN
    RAISE EXCEPTION 'cleanup journal identity and completed live deletion are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_cleanup_journal_guard BEFORE UPDATE OR DELETE ON performance_export_cleanup_attempts FOR EACH ROW EXECUTE FUNCTION performance_guard_cleanup_journal();
