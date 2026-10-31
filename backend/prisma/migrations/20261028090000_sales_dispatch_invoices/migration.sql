CREATE SEQUENCE sales_dispatch_invoice_number_seq START 1;
CREATE TABLE sales_dispatch_invoices (
  id TEXT PRIMARY KEY,
  number BIGINT NOT NULL DEFAULT nextval('sales_dispatch_invoice_number_seq'),
  "loadingId" TEXT NOT NULL REFERENCES logistics_loadings(id) ON DELETE RESTRICT,
  "requestKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  pdf BYTEA NOT NULL,
  "pdfSha256" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedBy" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3), "voidedBy" TEXT, "voidReason" TEXT,
  "replacesId" TEXT UNIQUE REFERENCES sales_dispatch_invoices(id) ON DELETE RESTRICT,
  CONSTRAINT sales_dispatch_invoice_void_complete CHECK (
    ("voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL) OR
    ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND length(trim("voidReason")) >= 3)
  )
);
CREATE UNIQUE INDEX sales_dispatch_invoices_number_key ON sales_dispatch_invoices(number);
CREATE UNIQUE INDEX "sales_dispatch_invoices_loadingId_requestKey_key" ON sales_dispatch_invoices("loadingId", "requestKey");
CREATE UNIQUE INDEX sales_dispatch_invoices_active_loading ON sales_dispatch_invoices("loadingId") WHERE "voidedAt" IS NULL;
CREATE INDEX "sales_dispatch_invoices_loadingId_issuedAt_idx" ON sales_dispatch_invoices("loadingId", "issuedAt");
CREATE FUNCTION protect_sales_dispatch_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Issued sales invoice history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY['voidedAt','voidedBy','voidReason']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['voidedAt','voidedBy','voidReason']) OR OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Issued sales invoice evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_sales_dispatch_invoice BEFORE UPDATE OR DELETE ON sales_dispatch_invoices
FOR EACH ROW EXECUTE FUNCTION protect_sales_dispatch_invoice();
