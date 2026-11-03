ALTER TABLE "accounting_financial_records"
ADD COLUMN "systemInvoiceNumber" TEXT,
ADD COLUMN "systemInvoiceDate" TIMESTAMP(3),
ADD COLUMN "financiallyApprovedAt" TIMESTAMP(3),
ADD COLUMN "financiallyApprovedBy" TEXT;

CREATE UNIQUE INDEX "accounting_financial_records_systemInvoiceNumber_key"
ON "accounting_financial_records"("systemInvoiceNumber");
