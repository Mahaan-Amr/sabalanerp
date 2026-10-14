ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "componentKind" TEXT NOT NULL DEFAULT 'BANK';
ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "receiptGroupId" TEXT;
ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "checkInstrumentId" TEXT;
CREATE UNIQUE INDEX "accounting_treasury_transactions_checkInstrumentId_key" ON "accounting_treasury_transactions"("checkInstrumentId");
CREATE INDEX "accounting_treasury_transactions_receiptGroupId_idx" ON "accounting_treasury_transactions"("receiptGroupId");
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "accounting_treasury_transactions_checkInstrumentId_fkey"
  FOREIGN KEY ("checkInstrumentId") REFERENCES "accounting_check_instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "accounting_receipt_component_kind_check"
  CHECK ("componentKind" IN ('BANK', 'CASH', 'CARD', 'CHECK'));
