ALTER TABLE "accounting_customer_open_items"
  ALTER COLUMN "invoiceId" DROP NOT NULL,
  ALTER COLUMN "contractId" DROP NOT NULL,
  ADD COLUMN "ledgerVoucherId" TEXT,
  ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'SALE',
  ADD COLUMN "description" TEXT;
ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "refundOfId" TEXT;
CREATE INDEX "accounting_treasury_transactions_refundOfId_idx" ON "accounting_treasury_transactions"("refundOfId");
ALTER TABLE "accounting_customer_open_items" ADD CONSTRAINT "customer_item_financial_source"
 CHECK ("invoiceId" IS NOT NULL OR ("ledgerVoucherId" IS NOT NULL AND "description" IS NOT NULL));
