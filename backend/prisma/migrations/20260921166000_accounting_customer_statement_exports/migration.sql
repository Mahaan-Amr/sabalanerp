CREATE TABLE "accounting_customer_statement_exports" (
  "id" TEXT NOT NULL,
  "requestIdentity" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "format" TEXT NOT NULL,
  "dataset" JSONB NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_customer_statement_exports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_customer_statement_exports_requestIdentity_key"
ON "accounting_customer_statement_exports"("requestIdentity");
CREATE INDEX "accounting_customer_statement_exports_profileId_asOf_idx"
ON "accounting_customer_statement_exports"("profileId", "asOf");
