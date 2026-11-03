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
  IF OLD."accountingApprovedBy" IS NOT NULL AND
    (OLD."accountingApprovedBy" IS DISTINCT FROM NEW."accountingApprovedBy"
      OR OLD."accountingApprovedAt" IS DISTINCT FROM NEW."accountingApprovedAt")
  THEN
    RAISE EXCEPTION 'Accounting outage approval is immutable';
  END IF;
  IF OLD."guardApprovedBy" IS NOT NULL AND
    (OLD."guardApprovedBy" IS DISTINCT FROM NEW."guardApprovedBy"
      OR OLD."guardApprovedAt" IS DISTINCT FROM NEW."guardApprovedAt")
  THEN
    RAISE EXCEPTION 'Guard outage approval is immutable';
  END IF;
  IF (NEW."accountingApprovedBy" IS NULL) <> (NEW."accountingApprovedAt" IS NULL)
    OR (NEW."guardApprovedBy" IS NULL) <> (NEW."guardApprovedAt" IS NULL)
  THEN
    RAISE EXCEPTION 'Outage approval actor and timestamp must be recorded together';
  END IF;
  IF (OLD."status" = 'PENDING_APPROVALS' AND NEW."status" NOT IN ('PENDING_APPROVALS','APPROVED','SPOILED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED','REGISTERED','SPOILED'))
  THEN
    RAISE EXCEPTION 'Invalid manual outage status transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
