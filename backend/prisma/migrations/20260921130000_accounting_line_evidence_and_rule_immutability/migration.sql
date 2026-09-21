ALTER TABLE "accounting_ledger_lines"
  ADD COLUMN "evidenceType" TEXT NOT NULL,
  ADD COLUMN "evidenceId" TEXT NOT NULL,
  ADD COLUMN "evidenceVersion" INTEGER NOT NULL,
  ADD COLUMN "evidenceHash" TEXT NOT NULL;

ALTER TABLE "accounting_ledger_lines"
  ADD CONSTRAINT "accounting_ledger_lines_evidence_version_check" CHECK ("evidenceVersion" >= 1),
  ADD CONSTRAINT "accounting_ledger_lines_evidence_identity_check" CHECK (length(btrim("evidenceType")) > 0 AND length(btrim("evidenceId")) > 0 AND length("evidenceHash") >= 8);

CREATE OR REPLACE FUNCTION accounting_guard_used_account_dimension_rules()
RETURNS trigger AS $$
DECLARE
  protected_at TIMESTAMP(3);
BEGIN
  SELECT "meaningLockedAt" INTO protected_at
  FROM "accounting_ledger_accounts"
  WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."accountId" ELSE NEW."accountId" END;
  IF protected_at IS NOT NULL THEN
    RAISE EXCEPTION 'Used accounting account dimension rules cannot be redefined';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_used_account_dimension_rule_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_account_dimension_rules"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_used_account_dimension_rules();
