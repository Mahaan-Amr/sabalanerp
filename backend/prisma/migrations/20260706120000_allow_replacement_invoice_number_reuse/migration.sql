DROP INDEX IF EXISTS "accounting_financial_records_systemInvoiceNumber_key";

CREATE INDEX IF NOT EXISTS "accounting_financial_records_systemInvoiceNumber_idx"
ON "accounting_financial_records"("systemInvoiceNumber");
