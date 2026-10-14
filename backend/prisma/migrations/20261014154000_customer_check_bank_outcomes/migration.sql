ALTER TABLE "accounting_check_instruments" ADD COLUMN "clearedRials" DECIMAL(20,0) NOT NULL DEFAULT 0;
ALTER TABLE "accounting_check_instruments" ADD COLUMN "unpaidRials" DECIMAL(20,0) NOT NULL DEFAULT 0;
ALTER TABLE "accounting_check_instruments" ADD CONSTRAINT "accounting_check_bank_outcome_amounts_check"
  CHECK ("clearedRials" >= 0 AND "unpaidRials" >= 0 AND "clearedRials" + "unpaidRials" <= "amountRials");
ALTER TABLE "accounting_check_instrument_events" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "accounting_check_instrument_events_idempotencyKey_key" ON "accounting_check_instrument_events"("idempotencyKey");
