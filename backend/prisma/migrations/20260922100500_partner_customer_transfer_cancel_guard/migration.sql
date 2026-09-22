CREATE OR REPLACE FUNCTION partner_guard_customer_transfer_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partner Customer transfer evidence is retained' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.id IS DISTINCT FROM NEW.id OR OLD."customerId" IS DISTINCT FROM NEW."customerId"
    OR OLD."matchId" IS DISTINCT FROM NEW."matchId" OR OLD."fromOwnerUserId" IS DISTINCT FROM NEW."fromOwnerUserId"
    OR OLD."fromProfileId" IS DISTINCT FROM NEW."fromProfileId"
    OR OLD."toProfileId" IS DISTINCT FROM NEW."toProfileId" OR OLD."requestedBy" IS DISTINCT FROM NEW."requestedBy"
    OR OLD."requestReason" IS DISTINCT FROM NEW."requestReason" OR OLD."requestedAt" IS DISTINCT FROM NEW."requestedAt"
    OR OLD."correlationId" IS DISTINCT FROM NEW."correlationId" OR OLD.status <> 'PENDING'
    OR NEW.status NOT IN ('APPROVED', 'REJECTED', 'CANCELLED') OR NEW.revision <> OLD.revision + 1
  ) THEN
    RAISE EXCEPTION 'Partner Customer transfer identity or lifecycle is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
