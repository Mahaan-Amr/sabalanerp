ALTER TABLE "accounting_commercial_customer_invoices"
ADD COLUMN "referenceInvoiceId" TEXT;

CREATE INDEX "accounting_commercial_customer_invoices_referenceInvoiceId_idx"
ON "accounting_commercial_customer_invoices"("referenceInvoiceId");
