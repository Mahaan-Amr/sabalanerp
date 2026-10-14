CREATE TABLE "accounting_customer_receipt_adjustments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "deltaRials" DECIMAL(20,0) NOT NULL CHECK ("deltaRials" <> 0),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "ledgerVoucherId" TEXT NOT NULL UNIQUE,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "commandHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("receiptId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("ledgerVoucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "accounting_customer_receipt_adjustments_receiptId_occurredAt_idx" ON "accounting_customer_receipt_adjustments"("receiptId", "occurredAt");
CREATE TRIGGER "accounting_customer_receipt_adjustment_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_receipt_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
