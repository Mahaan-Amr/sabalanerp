ALTER TYPE "PaymentMethod" ADD VALUE 'SELLER_CREDIT';
ALTER TABLE "sales_contracts" ADD COLUMN "dispatchExpiryExempt" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "seller_credit_accounts" (
  "sellerId" TEXT PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
  "limitRials" DECIMAL(18,0) NOT NULL DEFAULT 0 CHECK ("limitRials" >= 0),
  "updatedAt" TIMESTAMP(3) NOT NULL, "updatedBy" TEXT NOT NULL
);
CREATE TABLE "contract_dispatch_authorities" (
  "id" TEXT PRIMARY KEY, "contractId" TEXT NOT NULL REFERENCES "sales_contracts"("id") ON DELETE RESTRICT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('MANAGER','CREDIT','DATE','TRANSFER')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','REVOKED','SUPERSEDED')),
  "revision" INTEGER NOT NULL, "sellerId" TEXT REFERENCES "users"("id") ON DELETE RESTRICT,
  "targetSellerId" TEXT REFERENCES "users"("id") ON DELETE RESTRICT,
  "targetAuthorityId" TEXT REFERENCES "contract_dispatch_authorities"("id") ON DELETE RESTRICT,
  "amountRials" DECIMAL(18,0) NOT NULL DEFAULT 0 CHECK ("amountRials" >= 0),
  "promisedDate" DATE NOT NULL, "notifiedFor" TEXT, "requestedBy" TEXT NOT NULL,
  "decidedBy" TEXT, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "contract_dispatch_authorities_contractId_kind_status_idx" ON "contract_dispatch_authorities"("contractId","kind","status");
CREATE INDEX "contract_dispatch_authorities_sellerId_status_idx" ON "contract_dispatch_authorities"("sellerId","status");
CREATE INDEX "contract_dispatch_authorities_promisedDate_status_idx" ON "contract_dispatch_authorities"("promisedDate","status");
CREATE UNIQUE INDEX "contract_dispatch_authorities_current_credit" ON "contract_dispatch_authorities"("contractId") WHERE "kind"='CREDIT' AND "status"='APPROVED';
CREATE UNIQUE INDEX "contract_dispatch_authorities_pending_manager" ON "contract_dispatch_authorities"("contractId") WHERE "kind"='MANAGER' AND "status"='PENDING';
