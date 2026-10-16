ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "sourceParentId" TEXT;
ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "sourceAssetLedgerId" TEXT;
ALTER TABLE "accounting_treasury_transactions" ADD COLUMN "legacyRefundId" TEXT;
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "customer_receipt_source_parent_fk" FOREIGN KEY ("sourceParentId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "customer_receipt_source_asset_fk" FOREIGN KEY ("sourceAssetLedgerId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT;
ALTER TABLE "accounting_treasury_transactions" ADD CONSTRAINT "customer_receipt_legacy_refund_fk" FOREIGN KEY ("legacyRefundId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT;
CREATE INDEX "customer_receipt_source_parent_idx" ON "accounting_treasury_transactions"("sourceParentId");
CREATE TABLE "accounting_customer_receipt_resolutions" (
  "id" TEXT PRIMARY KEY, "receiptId" TEXT NOT NULL UNIQUE, "occurredAt" TIMESTAMP(3) NOT NULL,
  "evidence" JSONB NOT NULL, "idempotencyKey" TEXT NOT NULL UNIQUE, "commandHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_receipt_resolution_receipt_fk" FOREIGN KEY ("receiptId") REFERENCES "accounting_treasury_transactions"("id") ON DELETE RESTRICT
);
CREATE TRIGGER "customer_receipt_resolution_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_receipt_resolutions" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
