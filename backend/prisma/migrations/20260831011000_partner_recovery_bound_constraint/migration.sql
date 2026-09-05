-- A consumed Partner recovery keeps its immutable saved evidence for exact
-- idempotent replay. Permit that bound state only when it names the exact
-- Partner customer contract owned by the same seller.
ALTER TABLE sales_contract_edit_sessions
  DROP CONSTRAINT partner_technical_recovery_purpose_check;

ALTER TABLE sales_contract_edit_sessions
  ADD CONSTRAINT partner_technical_recovery_purpose_check
  CHECK (
    recovery IS NULL
    OR recovery->>'kind' IS DISTINCT FROM 'partner-technical-recovery'
    OR purpose = 'PARTNER_TECHNICAL'
  );

CREATE OR REPLACE FUNCTION partner_validate_technical_recovery_binding() RETURNS trigger AS $$
BEGIN
  IF NEW.recovery->>'kind' IS DISTINCT FROM 'partner-technical-recovery' THEN RETURN NEW; END IF;
  IF NEW.purpose <> 'PARTNER_TECHNICAL' THEN
    RAISE EXCEPTION 'Protected Partner recovery requires Partner technical purpose'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."contractId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_contracts
    WHERE id = NEW."contractId"
      AND "partnerKind" = 'PARTNER_CUSTOMER'
      AND "responsibleSellerId" = NEW."ownerUserId"
  ) THEN
    RAISE EXCEPTION 'Protected Partner recovery requires its exact Partner customer contract'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partner_technical_recovery_binding_guard
  BEFORE INSERT OR UPDATE OF recovery, purpose, "contractId", "ownerUserId" ON sales_contract_edit_sessions
  FOR EACH ROW EXECUTE FUNCTION partner_validate_technical_recovery_binding();
