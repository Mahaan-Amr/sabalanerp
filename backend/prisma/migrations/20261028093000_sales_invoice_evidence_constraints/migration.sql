ALTER TABLE sales_dispatch_invoices
  ADD CONSTRAINT sales_invoice_number_positive CHECK (number > 0),
  ADD CONSTRAINT sales_invoice_hashes CHECK (
    "sourceHash" ~ '^[0-9a-f]{64}$' AND "pdfSha256" ~ '^[0-9a-f]{64}$' AND octet_length(pdf) > 0
  ),
  ADD CONSTRAINT sales_invoice_explicit_void_reason CHECK (
    "voidedAt" IS NULL OR ("voidReason" IS NOT NULL AND "voidedBy" IS NOT NULL AND "voidedAt" >= "issuedAt")
  );
