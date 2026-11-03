ALTER TABLE "sales_contracts"
ADD COLUMN IF NOT EXISTS "creatorSequenceNumber" INTEGER;

CREATE INDEX IF NOT EXISTS "sales_contracts_createdBy_creatorSequenceNumber_idx"
ON "sales_contracts"("createdBy", "creatorSequenceNumber");
