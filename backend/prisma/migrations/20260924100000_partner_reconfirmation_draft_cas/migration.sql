BEGIN;
SET LOCAL lock_timeout = '5s';

-- A customer-visible Draft revision invalidates an earlier confirmation.
-- Preserve the Case CAS and committed-evidence fences while restoring the
-- versioned AWAITING/CUSTOMER_APPROVED -> DRAFT transition.
CREATE OR REPLACE FUNCTION partner_case_cas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' OR NEW."headRevision" <> 1 OR NEW."stateRevision" <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case starts with its first Draft revision';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."stateRevision" <> OLD."stateRevision" + 1 OR NEW."headRevision" NOT IN (OLD."headRevision", OLD."headRevision" + 1)
    OR (NEW."headRevision" = OLD."headRevision" AND (NEW."integrityHash" <> OLD."integrityHash" OR NEW."customerId" <> OLD."customerId"))
    OR (OLD."committedAt" IS NOT NULL AND (NEW."committedAt" IS DISTINCT FROM OLD."committedAt"
      OR NEW."commitmentTrigger" IS DISTINCT FROM OLD."commitmentTrigger" OR NEW."commitmentEventId" IS DISTINCT FROM OLD."commitmentEventId"
      OR NEW."committedRevision" IS DISTINCT FROM OLD."committedRevision"))
    OR (NEW.state <> OLD.state AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('AWAITING_CUSTOMER_CONFIRMATION','COMMITTED','CANCELLED'))
      OR (OLD.state IN ('AWAITING_CUSTOMER_CONFIRMATION','CUSTOMER_APPROVED') AND NEW.state = 'DRAFT'
        AND NEW."headRevision" = OLD."headRevision" + 1 AND OLD."customerContractId" IS NOT NULL
        AND NEW."customerConfirmationState" = 'RECONFIRMATION_REQUIRED')
      OR (OLD.state = 'AWAITING_CUSTOMER_CONFIRMATION' AND NEW.state IN ('CUSTOMER_APPROVED','COMMITTED','CANCELLED'))
      OR (OLD.state = 'CUSTOMER_APPROVED' AND NEW.state IN ('COMMITTED','CANCELLED'))
      OR (OLD.state = 'COMMITTED' AND NEW.state = 'VOIDED')))
    OR OLD.state IN ('CANCELLED','VOIDED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case mutation is stale or regresses retained lifecycle evidence';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
