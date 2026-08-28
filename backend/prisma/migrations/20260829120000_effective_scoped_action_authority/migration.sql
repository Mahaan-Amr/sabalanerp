BEGIN;

-- Empty opt-in action authority. Existing workspace/feature grants are neither
-- copied nor reinterpreted. One lock covers role changes in this store and the
-- absence of direct narrowing rows until the authorizing transaction commits.
CREATE TABLE effective_authorization_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision > 0)
);
INSERT INTO effective_authorization_state VALUES (1, 1);

CREATE TABLE effective_action_grants (
  id TEXT PRIMARY KEY,
  "principalKind" TEXT NOT NULL CHECK ("principalKind" IN ('USER', 'ROLE')),
  "principalId" TEXT NOT NULL CHECK (length(btrim("principalId")) BETWEEN 1 AND 200),
  "subjectUserId" TEXT REFERENCES users(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL CHECK (domain ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  action TEXT NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  "rootKind" TEXT NOT NULL CHECK ("rootKind" ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  purpose TEXT NOT NULL CHECK (purpose ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  scope TEXT NOT NULL CHECK (scope IN ('OWN', 'ASSIGNED', 'DEPARTMENT', 'COMPANY', 'PURPOSE_BOUND')),
  effect TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
  "boundRootId" TEXT,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "grantedBy" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  "correlationId" TEXT NOT NULL CHECK (length(btrim("correlationId")) BETWEEN 1 AND 200),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3), "revokedBy" TEXT REFERENCES users(id) ON DELETE RESTRICT,
  "revocationReason" TEXT, "revocationCorrelationId" TEXT,
  CHECK (("principalKind" = 'USER' AND "subjectUserId" IS NOT NULL AND "subjectUserId" = "principalId") OR
    ("principalKind" = 'ROLE' AND "subjectUserId" IS NULL)),
  CHECK ((scope = 'PURPOSE_BOUND' AND "boundRootId" IS NOT NULL AND length(btrim("boundRootId")) > 0) OR
    (scope <> 'PURPOSE_BOUND' AND "boundRootId" IS NULL)),
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "effectiveFrom"),
  CHECK (("revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL AND "revocationCorrelationId" IS NULL) OR
    ("revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND "revocationReason" IS NOT NULL
      AND "revocationCorrelationId" IS NOT NULL AND length(btrim("revocationReason")) BETWEEN 1 AND 2000
      AND length(btrim("revocationCorrelationId")) BETWEEN 1 AND 200))
);
CREATE INDEX effective_action_grants_principal_idx ON effective_action_grants ("principalKind", "principalId", domain);

CREATE FUNCTION effective_action_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'Scoped grant history is retained'; END IF;
  IF NEW."principalKind" = 'ROLE' AND NOT EXISTS (
    SELECT 1 FROM unnest(enum_range(NULL::"UserRole")) role WHERE role::text = NEW."principalId"
  ) THEN RAISE EXCEPTION 'Unknown grant role'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR
    (to_jsonb(NEW) - ARRAY['revokedAt','revokedBy','revocationReason','revocationCorrelationId']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['revokedAt','revokedBy','revocationReason','revocationCorrelationId'])) THEN
    RAISE EXCEPTION 'Scoped grant identity and provenance are immutable';
  END IF;
  UPDATE effective_authorization_state SET revision = revision + 1 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Scoped authority state unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER effective_action_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON effective_action_grants
  FOR EACH ROW EXECUTE FUNCTION effective_action_grant_guard();
CREATE TRIGGER effective_action_grant_truncate_guard BEFORE TRUNCATE ON effective_action_grants
  FOR EACH STATEMENT EXECUTE FUNCTION effective_action_grant_guard();

COMMIT;
