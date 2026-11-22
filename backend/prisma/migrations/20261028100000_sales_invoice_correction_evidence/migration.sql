CREATE TABLE sales_invoice_corrections (
  id TEXT PRIMARY KEY,
  "correctionId" TEXT NOT NULL UNIQUE REFERENCES dispatch_corrections(id) ON DELETE RESTRICT,
  snapshot JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL UNIQUE CHECK ("integrityHash" ~ '^[0-9a-f]{64}$'),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL
);
CREATE FUNCTION protect_sales_invoice_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Sales invoice correction evidence is immutable'; END $$;
CREATE TRIGGER protect_sales_invoice_correction BEFORE UPDATE OR DELETE ON sales_invoice_corrections
FOR EACH ROW EXECUTE FUNCTION protect_sales_invoice_correction();
