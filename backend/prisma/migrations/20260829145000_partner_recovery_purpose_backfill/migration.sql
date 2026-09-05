-- Upgrade pre-purpose durable Partner recoveries without exposing or
-- abandoning them. A protected envelope can only be creator-private.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM sales_contract_edit_sessions
    WHERE recovery->>'kind' = 'partner-technical-recovery' AND "contractId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Protected Partner recovery has an ambiguous Contract binding';
  END IF;
END;
$$;

DROP TRIGGER partner_edit_session_purpose_guard ON sales_contract_edit_sessions;
DROP TRIGGER partner_persona_edit_session_guard ON sales_contract_edit_sessions;

UPDATE sales_contract_edit_sessions
SET purpose = 'PARTNER_TECHNICAL'
WHERE recovery->>'kind' = 'partner-technical-recovery'
  AND "contractId" IS NULL
  AND purpose = 'STANDARD';

ALTER TABLE sales_contract_edit_sessions
  ADD CONSTRAINT partner_technical_recovery_purpose_check
  CHECK (
    recovery IS NULL
    OR recovery->>'kind' IS DISTINCT FROM 'partner-technical-recovery'
    OR (purpose = 'PARTNER_TECHNICAL' AND "contractId" IS NULL)
  );

CREATE TRIGGER partner_edit_session_purpose_guard
  BEFORE UPDATE OF purpose ON sales_contract_edit_sessions
  FOR EACH ROW EXECUTE FUNCTION partner_edit_session_purpose_immutable();

CREATE TRIGGER partner_persona_edit_session_guard
  BEFORE INSERT OR UPDATE ON sales_contract_edit_sessions
  FOR EACH ROW EXECUTE FUNCTION partner_reject_incompatible_persona();
