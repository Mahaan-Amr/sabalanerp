CREATE UNIQUE INDEX "accounting_bank_one_confirmed_match"
ON "accounting_bank_reconciliation_matches" ("bankStatementLineId")
WHERE "status" = 'CONFIRMED';
