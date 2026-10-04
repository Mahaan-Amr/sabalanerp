ALTER TYPE "PaymentMethod" ADD VALUE 'SPECIAL_CUSTOMER_CREDIT';
ALTER TABLE "crm_customers"
  ADD COLUMN "trustCategory" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "creditLimitRials" DECIMAL(18,0),
  ADD COLUMN "creditPolicyVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "crm_customers_trust_category_check" CHECK ("trustCategory" IN ('NORMAL', 'SPECIAL')),
  ADD CONSTRAINT "crm_customers_credit_limit_check" CHECK ("creditLimitRials" IS NULL OR "creditLimitRials" >= 0);
ALTER TABLE "sales_contracts"
  ADD COLUMN "customerCreditCustomerId" TEXT,
  ADD COLUMN "customerCreditAmountRials" DECIMAL(18,0) NOT NULL DEFAULT 0,
  ADD COLUMN "customerCreditTotalRials" DECIMAL(18,0) NOT NULL DEFAULT 0,
  ADD COLUMN "customerCreditRevision" INTEGER,
  ADD COLUMN "customerCreditPromisedDate" DATE,
  ADD COLUMN "customerCreditNotifiedFor" TEXT,
  ADD CONSTRAINT "sales_contracts_customer_credit_customer_fk" FOREIGN KEY ("customerCreditCustomerId") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "sales_contracts_customer_credit_amount_check" CHECK ("customerCreditAmountRials" >= 0);
CREATE INDEX "sales_contracts_customer_credit_customer_idx" ON "sales_contracts"("customerCreditCustomerId");
