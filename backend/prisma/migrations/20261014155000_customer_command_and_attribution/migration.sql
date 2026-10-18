CREATE TABLE "accounting_customer_commands" (
  "id" TEXT PRIMARY KEY, "profileId" TEXT NOT NULL REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL UNIQUE, "commandHash" TEXT NOT NULL,
  "result" JSONB NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "accounting_customer_commands_profileId_createdAt_idx" ON "accounting_customer_commands"("profileId", "createdAt");
CREATE TRIGGER "accounting_customer_command_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_commands"
  FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TABLE "accounting_customer_opening_attributions" (
  "id" TEXT PRIMARY KEY, "openingReviewId" TEXT NOT NULL REFERENCES "accounting_customer_opening_reviews"("id") ON DELETE RESTRICT,
  "lineKey" TEXT NOT NULL, "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "financialRecordId" TEXT REFERENCES "accounting_financial_records"("id") ON DELETE RESTRICT,
  "contractId" TEXT REFERENCES "sales_contracts"("id") ON DELETE RESTRICT,
  "reference" TEXT NOT NULL, "reason" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL UNIQUE,
  "commandHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("openingReviewId", "lineKey", "sequence")
);
CREATE TRIGGER "accounting_customer_opening_attribution_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_opening_attributions"
  FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
