CREATE TABLE "accounting_customer_opening_reviews" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "basisAt" TIMESTAMP(3) NOT NULL,
  "totalRials" DECIMAL(20,0) NOT NULL,
  "transferRials" DECIMAL(20,0) NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_customer_opening_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_customer_opening_reviews_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "accounting_customer_opening_reviews_profileId_key" ON "accounting_customer_opening_reviews"("profileId");
CREATE UNIQUE INDEX "accounting_customer_opening_reviews_idempotencyKey_key" ON "accounting_customer_opening_reviews"("idempotencyKey");
CREATE TRIGGER "accounting_customer_opening_review_immutable"
  BEFORE UPDATE OR DELETE ON "accounting_customer_opening_reviews"
  FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
