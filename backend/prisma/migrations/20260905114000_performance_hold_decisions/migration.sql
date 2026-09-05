CREATE TABLE performance_legal_hold_decisions (
  id TEXT PRIMARY KEY,
  "holdId" TEXT NOT NULL REFERENCES performance_legal_holds(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('REVIEW','APPROVE_RELEASE')),
  "actorUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "reasonCode" TEXT NOT NULL,
  "authorityHash" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX performance_hold_decisions_scope ON performance_legal_hold_decisions("holdId", action, "decidedAt");
CREATE INDEX performance_hold_release_actor ON performance_legal_hold_decisions("holdId", "actorUserId") WHERE action = 'APPROVE_RELEASE';
CREATE TRIGGER performance_hold_decisions_immutable BEFORE UPDATE OR DELETE ON performance_legal_hold_decisions FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE FUNCTION performance_require_independent_hold_release() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ACTIVE' AND NEW.status = 'RELEASED' AND
    (SELECT count(DISTINCT "actorUserId") FROM performance_legal_hold_decisions
      WHERE "holdId" = OLD.id AND action = 'APPROVE_RELEASE' AND "reasonCode" = NEW."releaseReason" AND "decidedAt" >= clock_timestamp() - interval '24 hours') < 2 THEN
    RAISE EXCEPTION 'two current independent decisions required to release legal hold';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_hold_independent_release BEFORE UPDATE ON performance_legal_holds FOR EACH ROW EXECUTE FUNCTION performance_require_independent_hold_release();
