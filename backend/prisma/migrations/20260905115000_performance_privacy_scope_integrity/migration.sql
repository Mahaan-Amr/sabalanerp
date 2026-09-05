CREATE FUNCTION performance_guard_privacy_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM performance_privacy_cases c JOIN performance_evaluations e ON e."subjectId" = c."subjectId"
    WHERE c.id = NEW."caseId" AND e.id = NEW."evaluationId" AND c.status = 'RECEIVED') THEN
    RAISE EXCEPTION 'privacy scope must belong to the requested subject and be frozen before acknowledgement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_privacy_scope_membership BEFORE INSERT ON performance_privacy_scopes FOR EACH ROW EXECUTE FUNCTION performance_guard_privacy_scope();
ALTER TABLE performance_privacy_cases ADD CONSTRAINT performance_privacy_deadlines CHECK
  ("requestedAt" < "acknowledgeBy" AND "acknowledgeBy" <= "verifyBy" AND "verifyBy" < "respondBy");
ALTER TABLE performance_privacy_cases ADD CONSTRAINT performance_privacy_closure CHECK
  ((status = 'CLOSED' AND "closedAt" IS NOT NULL) OR (status <> 'CLOSED' AND "closedAt" IS NULL));
CREATE FUNCTION performance_guard_privacy_progress() RETURNS trigger AS $$
DECLARE candidate TIMESTAMP; days INTEGER := 15;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RECEIVED' OR NEW.version <> 1 OR NEW."extensionCount" <> 0 OR NEW."identityVerifiedAt" IS NOT NULL
      OR NEW."verifiedByUserId" IS NOT NULL OR NEW."encryptedResponseId" IS NOT NULL THEN RAISE EXCEPTION 'privacy request must start at receipt'; END IF;
  ELSE
    IF NEW."extensionCount" IS DISTINCT FROM OLD."extensionCount" OR NEW."respondBy" IS DISTINCT FROM OLD."respondBy" THEN
      IF OLD.status <> 'VERIFIED' OR NEW.status <> 'VERIFIED' OR OLD."extensionCount" <> 0 OR NEW."extensionCount" <> 1 THEN
        RAISE EXCEPTION 'one verified privacy response extension allowed';
      END IF;
      candidate := OLD."respondBy";
      WHILE days > 0 LOOP
        candidate := candidate + interval '1 day';
        IF extract(dow FROM (candidate AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')) <> 5 THEN days := days - 1; END IF;
      END LOOP;
      IF NEW."respondBy" <> candidate THEN RAISE EXCEPTION 'privacy extension must be fifteen working days'; END IF;
    END IF;
  END IF;
  IF NEW.status IN ('RECEIVED','ACKNOWLEDGED') AND (NEW."identityVerifiedAt" IS NOT NULL OR NEW."verifiedByUserId" IS NOT NULL OR NEW."encryptedResponseId" IS NOT NULL) THEN
    RAISE EXCEPTION 'privacy verification and response cannot be recorded early';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_privacy_progress BEFORE INSERT OR UPDATE ON performance_privacy_cases FOR EACH ROW EXECUTE FUNCTION performance_guard_privacy_progress();
CREATE FUNCTION performance_guard_restriction_scope() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'ACTIVE' THEN RAISE EXCEPTION 'restriction must start active'; END IF;
  IF NEW."privacyCaseId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM performance_privacy_scopes
    WHERE "caseId" = NEW."privacyCaseId" AND "evaluationId" = NEW."evaluationId") THEN RAISE EXCEPTION 'restriction is outside privacy request scope'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_restriction_scope BEFORE INSERT ON performance_evidence_restrictions FOR EACH ROW EXECUTE FUNCTION performance_guard_restriction_scope();
-- Revocation participates in the same linearization boundary as artifact claims.
CREATE TRIGGER performance_grant_disclosure_revision BEFORE INSERT OR UPDATE OR DELETE ON hr_feature_access_grants FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision();
CREATE TRIGGER performance_user_disclosure_revision BEFORE UPDATE OF "isActive" ON users FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision();

-- Export receipt creation serializes with evidence but does not invalidate its own snapshot.
CREATE OR REPLACE FUNCTION performance_guard_canonical_write() RETURNS trigger AS $$
DECLARE body JSONB := to_jsonb(NEW); subject_id TEXT; evaluation_id TEXT; section_id TEXT;
BEGIN
  -- Updating the shared fence forces a stale Serializable writer to retry rather than overlook a pause.
  UPDATE performance_disclosure_revision SET revision = revision,
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

CREATE TRIGGER performance_policy_disclosure_revision BEFORE INSERT OR UPDATE OR DELETE ON performance_policy_versions FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision();
