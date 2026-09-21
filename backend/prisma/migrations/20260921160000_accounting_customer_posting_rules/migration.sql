CREATE TABLE "accounting_customer_posting_rules" (
  "id" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "receivableAccountId" TEXT NOT NULL,
  "revenueAccountId" TEXT NOT NULL,
  "outputTaxAccountId" TEXT NOT NULL,
  "inventoryAccountId" TEXT NOT NULL,
  "costAccountId" TEXT NOT NULL,
  "bankClearingAccountId" TEXT NOT NULL,
  "customerAdvanceAccountId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "evidenceHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_customer_posting_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_customer_posting_rules_legalEntityId_code_version_key"
ON "accounting_customer_posting_rules"("legalEntityId", "code", "version");
CREATE INDEX "accounting_customer_posting_rules_legalEntityId_effective_idx"
ON "accounting_customer_posting_rules"("legalEntityId", "effectiveFrom", "effectiveTo");
CREATE TRIGGER "accounting_customer_posting_rule_immutable"
BEFORE UPDATE OR DELETE ON "accounting_customer_posting_rules"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
