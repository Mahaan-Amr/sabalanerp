CREATE OR REPLACE FUNCTION accounting_guard_used_account_dimension_rules()
RETURNS trigger AS $$
DECLARE
  old_locked TIMESTAMP(3);
  new_locked TIMESTAMP(3);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "meaningLockedAt" INTO old_locked FROM "accounting_ledger_accounts" WHERE "id" = OLD."accountId" FOR UPDATE;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "meaningLockedAt" INTO new_locked FROM "accounting_ledger_accounts" WHERE "id" = NEW."accountId" FOR UPDATE;
  END IF;
  IF old_locked IS NOT NULL OR new_locked IS NOT NULL THEN
    RAISE EXCEPTION 'Used accounting account dimension rules cannot be redefined';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "accounting_used_account_dimension_rule_immutability" ON "accounting_ledger_account_dimension_rules";
CREATE TRIGGER "accounting_used_account_dimension_rule_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "accounting_ledger_account_dimension_rules"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_used_account_dimension_rules();
