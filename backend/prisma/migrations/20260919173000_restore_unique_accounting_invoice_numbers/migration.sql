CREATE TABLE "accounting_invoice_number_claims" (
  "number" TEXT NOT NULL,
  "financialRecordId" TEXT NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_invoice_number_claims_pkey" PRIMARY KEY ("number")
);

CREATE UNIQUE INDEX "accounting_invoice_number_claims_financialRecordId_key"
  ON "accounting_invoice_number_claims"("financialRecordId");

INSERT INTO "accounting_invoice_number_claims" ("number", "financialRecordId", "claimedAt")
SELECT DISTINCT ON (record."systemInvoiceNumber")
  record."systemInvoiceNumber",
  record."id",
  COALESCE(record."financiallyApprovedAt", record."createdAt")
FROM "accounting_financial_records" AS record
WHERE record."systemInvoiceNumber" IS NOT NULL
ORDER BY record."systemInvoiceNumber", record."createdAt", record."id";

ALTER TABLE "accounting_invoice_number_claims"
  ADD CONSTRAINT "accounting_invoice_number_claims_financialRecordId_fkey"
  FOREIGN KEY ("financialRecordId") REFERENCES "accounting_financial_records"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
