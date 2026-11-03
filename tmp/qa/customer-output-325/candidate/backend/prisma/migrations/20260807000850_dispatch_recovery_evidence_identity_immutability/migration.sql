CREATE OR REPLACE FUNCTION prevent_registered_manual_outage_exit_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Manual outage records are append-only';
  END IF;
  IF OLD."status" IN ('REGISTERED','SPOILED') THEN
    RAISE EXCEPTION 'Final manual outage records are immutable';
  END IF;
  IF OLD."paperNumber" IS DISTINCT FROM NEW."paperNumber"
    OR OLD."outageId" IS DISTINCT FROM NEW."outageId"
    OR OLD."waybillId" IS DISTINCT FROM NEW."waybillId"
    OR OLD."queueTurnId" IS DISTINCT FROM NEW."queueTurnId"
    OR OLD."allocationRevisionId" IS DISTINCT FROM NEW."allocationRevisionId"
    OR OLD."actualOccurredAt" IS DISTINCT FROM NEW."actualOccurredAt"
    OR OLD."paperEvidence" IS DISTINCT FROM NEW."paperEvidence"
  THEN
    RAISE EXCEPTION 'Manual outage evidence identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_dispatch_outage_evidence_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Dispatch outage records are append-only';
  END IF;
  IF OLD."status" = 'ENDED' THEN
    RAISE EXCEPTION 'Ended dispatch outage records are immutable';
  END IF;
  IF OLD."scope" IS DISTINCT FROM NEW."scope"
    OR OLD."reason" IS DISTINCT FROM NEW."reason"
    OR OLD."verification" IS DISTINCT FROM NEW."verification"
    OR OLD."actualStartedAt" IS DISTINCT FROM NEW."actualStartedAt"
    OR OLD."verifiedAt" IS DISTINCT FROM NEW."verifiedAt"
    OR OLD."verifiedBy" IS DISTINCT FROM NEW."verifiedBy"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'Dispatch outage verification evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "dispatch_outage_evidence_immutable"
BEFORE UPDATE OR DELETE ON "dispatch_outages"
FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_outage_evidence_mutation();
