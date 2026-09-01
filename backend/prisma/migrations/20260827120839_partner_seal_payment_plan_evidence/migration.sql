BEGIN;
SET LOCAL lock_timeout = '5s';

-- A payment plan, like the graph, is part of one immutable commercial revision.
CREATE TRIGGER partner_atomic_assembly BEFORE INSERT ON partner_payment_plans
  FOR EACH ROW EXECUTE FUNCTION partner_revision_assembly_only();

CREATE FUNCTION partner_installment_assembly_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_payment_plans p JOIN partner_case_revisions r
    ON r."caseId" = p."caseId" AND r.revision = p."caseRevision"
    WHERE p.id = NEW."planId" AND r."assemblyTransaction" = txid_current()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Installments must be assembled with their immutable payment plan revision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_atomic_assembly BEFORE INSERT ON partner_payment_installments
  FOR EACH ROW EXECUTE FUNCTION partner_installment_assembly_only();
COMMIT;
