CREATE TABLE "accounting_financial_approval_receipts" (
    "financialRecordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_financial_approval_receipts_pkey" PRIMARY KEY ("financialRecordId"),
    CONSTRAINT "accounting_financial_approval_receipts_financialRecordId_fkey"
      FOREIGN KEY ("financialRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
