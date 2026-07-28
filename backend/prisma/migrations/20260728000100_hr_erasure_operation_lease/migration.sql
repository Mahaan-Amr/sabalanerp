ALTER TABLE "hr_deletion_receipts"
  ADD COLUMN "operationToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "hr_deletion_receipts_status_leaseExpiresAt_idx"
  ON "hr_deletion_receipts"("status", "leaseExpiresAt");
