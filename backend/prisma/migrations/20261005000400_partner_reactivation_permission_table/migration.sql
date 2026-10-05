BEGIN;
SET LOCAL lock_timeout = '5s';

-- Reopening requires a retained cancellation and an exact reactivation event.
-- First commitment evidence, version CAS and all other terminal fences remain intact.
CREATE OR REPLACE FUNCTION partner_case_cas() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reactivating boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IN ('CANCELLED', 'VOIDED') THEN
    reactivating := NEW.state::text = CASE WHEN OLD.state = 'VOIDED' THEN 'COMMITTED' ELSE 'DRAFT' END
      AND NEW."headRevision" = OLD."headRevision"
      AND NEW."stateRevision" = OLD."stateRevision" + 1
      AND NEW."commercialFlowVersion" = 1
      AND EXISTS (SELECT 1 FROM partner_case_events e
        WHERE e."caseId" = OLD.id AND e.type = 'CASE_REACTIVATED'
          AND e."caseRevision" = OLD."headRevision" AND e."integrityHash" = OLD."integrityHash"
          AND e."stateRevision" = NEW."stateRevision" AND e."fromState"::text = OLD.state::text AND e."toState"::text = NEW.state::text
          AND e.evidence->'publicEvent'->>'eventId' = e.id
          AND e.evidence->'publicEvent'->>'type' = e.type
          AND EXISTS (SELECT 1 FROM partner_case_events c
            WHERE c.id = e.evidence->'publicEvent'->>'cancellationEventId' AND c."caseId" = OLD.id
              AND c.type = CASE WHEN OLD.state = 'VOIDED' THEN 'CASE_VOIDED' ELSE 'CASE_CANCELLED' END
              AND c.sequence < e.sequence)
          AND (OLD.state = 'CANCELLED' OR EXISTS (SELECT 1 FROM hr_duties d
            JOIN accounting_correction_requests r ON r.id = d."sourceId"
            WHERE d.id = e.evidence->'publicEvent'->>'permissionId'
              AND d."sourceType" = 'SALES_CONTRACT_CORRECTION' AND d."sourceActionCode" = 'SALES_EDIT_CONTRACT_CORRECTION'
              AND r."contractId" = OLD."customerContractId" AND r.status = 'APPROVED_FOR_SALES_EDIT'
              AND d.status = 'OPEN' AND d."currentAssigneeUserId" = e."actorId" AND d."dueAt" > e."recordedAt")));
  END IF;
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
      OR (OLD.state = 'COMMITTED' AND NEW.state = 'VOIDED') OR reactivating))
    OR (OLD.state IN ('CANCELLED','VOIDED') AND NOT reactivating) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case mutation is stale or regresses retained lifecycle evidence';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
