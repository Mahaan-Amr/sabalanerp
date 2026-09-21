ALTER TABLE "accounting_bank_reconciliation_matches"
ADD COLUMN "confirmationReason" TEXT,
ADD COLUMN "reversalReason" TEXT;

UPDATE "accounting_bank_reconciliation_matches"
SET "confirmationReason" = "reason"
WHERE "confirmedAt" IS NOT NULL AND "reason" IS NOT NULL;
