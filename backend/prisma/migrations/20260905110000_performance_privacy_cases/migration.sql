CREATE TABLE performance_privacy_cases (
  "id" TEXT PRIMARY KEY,
  "subjectId" TEXT NOT NULL REFERENCES performance_subjects("id") ON DELETE RESTRICT,
  "requestKind" TEXT NOT NULL CHECK ("requestKind" IN ('ACCESS','CORRECTION','ERASURE')),
  "status" TEXT NOT NULL DEFAULT 'RECEIVED' CHECK ("status" IN ('RECEIVED','ACKNOWLEDGED','VERIFIED','RESPONDED','CLOSED')),
  "requestedByUserId" TEXT NOT NULL REFERENCES users("id") ON DELETE RESTRICT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgeBy" TIMESTAMP(3) NOT NULL,
  "verifyBy" TIMESTAMP(3) NOT NULL,
  "respondBy" TIMESTAMP(3) NOT NULL,
  "extensionCount" INTEGER NOT NULL DEFAULT 0 CHECK ("extensionCount" IN (0,1)),
  "identityVerifiedAt" TIMESTAMP(3),
  "verifiedByUserId" TEXT REFERENCES users("id") ON DELETE RESTRICT,
  "scopeHash" TEXT NOT NULL,
  "encryptedRequestId" TEXT NOT NULL UNIQUE REFERENCES performance_encrypted_payloads("id") ON DELETE RESTRICT,
  "encryptedResponseId" TEXT UNIQUE REFERENCES performance_encrypted_payloads("id") ON DELETE RESTRICT,
  "closedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0)
);
CREATE INDEX performance_privacy_cases_subject_status ON performance_privacy_cases("subjectId", "status");
CREATE INDEX performance_privacy_cases_due ON performance_privacy_cases("status", "respondBy");
CREATE TABLE performance_privacy_scopes (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES performance_privacy_cases("id") ON DELETE RESTRICT,
  "evaluationId" TEXT NOT NULL REFERENCES performance_evaluations("id") ON DELETE RESTRICT,
  UNIQUE ("caseId", "evaluationId")
);
CREATE INDEX performance_privacy_scopes_evaluation ON performance_privacy_scopes("evaluationId");
CREATE TABLE performance_privacy_decisions (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES performance_privacy_cases("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL REFERENCES users("id") ON DELETE RESTRICT,
  "authorityHash" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("caseId", "version")
);
CREATE TABLE performance_evidence_restrictions (
  "id" TEXT PRIMARY KEY,
  "evaluationId" TEXT NOT NULL REFERENCES performance_evaluations("id") ON DELETE RESTRICT,
  "privacyCaseId" TEXT REFERENCES performance_privacy_cases("id") ON DELETE RESTRICT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','RELEASED')),
  "reasonCode" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL REFERENCES users("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedByUserId" TEXT REFERENCES users("id") ON DELETE RESTRICT,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT,
  CHECK (("status" = 'ACTIVE' AND "releasedAt" IS NULL AND "releasedByUserId" IS NULL AND "releaseReason" IS NULL)
    OR ("status" = 'RELEASED' AND "releasedAt" IS NOT NULL AND "releasedByUserId" IS NOT NULL AND length(trim("releaseReason")) > 0))
);
CREATE INDEX performance_restrictions_evaluation_status ON performance_evidence_restrictions("evaluationId", "status");
CREATE INDEX performance_restrictions_case ON performance_evidence_restrictions("privacyCaseId");
CREATE TRIGGER performance_privacy_decisions_immutable BEFORE UPDATE OR DELETE ON performance_privacy_decisions FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_privacy_scope_immutable BEFORE UPDATE OR DELETE ON performance_privacy_scopes FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();

CREATE FUNCTION performance_guard_privacy_case() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'privacy evidence requires retention erasure'; END IF;
  IF NEW."version" <> OLD."version" + 1 OR
    (to_jsonb(NEW) - ARRAY['version','status','respondBy','extensionCount','identityVerifiedAt','verifiedByUserId','encryptedResponseId','closedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['version','status','respondBy','extensionCount','identityVerifiedAt','verifiedByUserId','encryptedResponseId','closedAt']) THEN
    RAISE EXCEPTION 'privacy case identity and scope are immutable';
  END IF;
  IF OLD."status" = 'CLOSED' OR (OLD."identityVerifiedAt" IS NOT NULL AND
    (NEW."identityVerifiedAt" IS DISTINCT FROM OLD."identityVerifiedAt" OR NEW."verifiedByUserId" IS DISTINCT FROM OLD."verifiedByUserId")) THEN
    RAISE EXCEPTION 'privacy case verification is immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'RECEIVED' AND NEW."status" = 'ACKNOWLEDGED') OR
    (OLD."status" = 'ACKNOWLEDGED' AND NEW."status" = 'VERIFIED') OR
    (OLD."status" = 'VERIFIED' AND NEW."status" = 'RESPONDED') OR
    (OLD."status" = 'RESPONDED' AND NEW."status" = 'CLOSED')) THEN RAISE EXCEPTION 'invalid privacy case transition'; END IF;
  IF NEW."status" IN ('VERIFIED','RESPONDED','CLOSED') AND (NEW."identityVerifiedAt" IS NULL OR NEW."verifiedByUserId" IS NULL) THEN RAISE EXCEPTION 'privacy identity verification required'; END IF;
  IF NEW."status" IN ('RESPONDED','CLOSED') AND NEW."encryptedResponseId" IS NULL THEN RAISE EXCEPTION 'privacy response evidence required'; END IF;
  IF OLD."encryptedResponseId" IS NOT NULL AND NEW."encryptedResponseId" IS DISTINCT FROM OLD."encryptedResponseId" THEN RAISE EXCEPTION 'privacy response is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_privacy_case_guard BEFORE UPDATE OR DELETE ON performance_privacy_cases FOR EACH ROW EXECUTE FUNCTION performance_guard_privacy_case();
CREATE FUNCTION performance_guard_restriction() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'restriction evidence is immutable'; END IF;
  IF OLD."status" <> 'ACTIVE' OR NEW."status" <> 'RELEASED' OR
    (to_jsonb(NEW) - ARRAY['status','releasedByUserId','releasedAt','releaseReason']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','releasedByUserId','releasedAt','releaseReason']) THEN
    RAISE EXCEPTION 'restriction may only be explicitly released';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_restriction_guard BEFORE UPDATE OR DELETE ON performance_evidence_restrictions FOR EACH ROW EXECUTE FUNCTION performance_guard_restriction();
