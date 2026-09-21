ALTER TABLE "accounting_petty_cash_advances"
ADD COLUMN "treasuryTransactionId" TEXT;

CREATE TABLE "accounting_petty_cash_settlements" (
  "id" TEXT NOT NULL,
  "advanceId" TEXT NOT NULL,
  "ledgerVoucherId" TEXT NOT NULL,
  "settledRials" DECIMAL(20,0) NOT NULL,
  "evidence" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "settledAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_petty_cash_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_petty_cash_advances_treasuryTransactionId_key"
ON "accounting_petty_cash_advances"("treasuryTransactionId");
CREATE UNIQUE INDEX "accounting_petty_cash_settlements_advanceId_key"
ON "accounting_petty_cash_settlements"("advanceId");
CREATE UNIQUE INDEX "accounting_petty_cash_settlements_ledgerVoucherId_key"
ON "accounting_petty_cash_settlements"("ledgerVoucherId");

ALTER TABLE "accounting_petty_cash_advances" ADD CONSTRAINT "accounting_petty_cash_advances_treasuryTransactionId_fkey"
FOREIGN KEY ("treasuryTransactionId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_petty_cash_settlements" ADD CONSTRAINT "accounting_petty_cash_settlements_advanceId_fkey"
FOREIGN KEY ("advanceId") REFERENCES "accounting_petty_cash_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounting_petty_cash_settlements" ADD CONSTRAINT "accounting_petty_cash_settlement_amount_check"
CHECK ("settledRials" > 0);
CREATE TRIGGER "accounting_petty_cash_settlement_immutable"
BEFORE UPDATE OR DELETE ON "accounting_petty_cash_settlements"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

-- No pre-existing rows are expected in this new tracer-bullet table. Fail closed if that assumption changes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "accounting_petty_cash_advances" WHERE "treasuryTransactionId" IS NULL) THEN
    RAISE EXCEPTION 'PETTY_CASH_ADVANCE_BACKFILL_REQUIRED';
  END IF;
END $$;
ALTER TABLE "accounting_petty_cash_advances" ALTER COLUMN "treasuryTransactionId" SET NOT NULL;
