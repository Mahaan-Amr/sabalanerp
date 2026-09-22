ALTER TABLE "accounting_ledger_accounts"
  ADD COLUMN "partyRequirement" "AccountingDimensionRequirement" NOT NULL DEFAULT 'FORBIDDEN',
  ADD COLUMN "financialAccountRequirement" "AccountingDimensionRequirement" NOT NULL DEFAULT 'FORBIDDEN';

ALTER TABLE "accounting_ledger_lines"
  ADD COLUMN "partyId" TEXT,
  ADD COLUMN "financialAccountId" TEXT;

CREATE INDEX "accounting_ledger_lines_partyId_voucherId_idx" ON "accounting_ledger_lines"("partyId", "voucherId");
CREATE INDEX "accounting_ledger_lines_financialAccountId_voucherId_idx" ON "accounting_ledger_lines"("financialAccountId", "voucherId");

ALTER TABLE "accounting_ledger_lines"
  ADD CONSTRAINT "accounting_ledger_lines_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "accounting_ledger_lines_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "accounting_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION accounting_guard_control_account_semantics()
RETURNS trigger AS $$
BEGIN
  IF OLD."meaningLockedAt" IS NOT NULL AND
     (NEW."partyRequirement" IS DISTINCT FROM OLD."partyRequirement"
      OR NEW."financialAccountRequirement" IS DISTINCT FROM OLD."financialAccountRequirement") THEN
    RAISE EXCEPTION 'Used accounting account detail rules cannot be redefined';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_control_account_semantics_immutability"
BEFORE UPDATE ON "accounting_ledger_accounts"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_control_account_semantics();
