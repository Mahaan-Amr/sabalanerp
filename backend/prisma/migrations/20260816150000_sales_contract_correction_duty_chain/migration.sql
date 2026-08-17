ALTER TABLE "accounting_correction_requests"
ADD COLUMN "requestIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "accounting_correction_requests_requestIdempotencyKey_key"
ON "accounting_correction_requests"("requestIdempotencyKey");

CREATE UNIQUE INDEX "accounting_correction_requests_one_active_contract_key"
ON "accounting_correction_requests"("contractId")
WHERE "contractId" IS NOT NULL
  AND "status" IN ('OPEN', 'ACKNOWLEDGED', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED');
