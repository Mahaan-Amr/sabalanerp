BEGIN;

CREATE TABLE "sepidar_dispatch_invoices" (
  "number" TEXT PRIMARY KEY,
  "loadingId" TEXT NOT NULL REFERENCES "logistics_loadings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountRial" DECIMAL(50, 12),
  CONSTRAINT "sepidar_dispatch_invoice_amount_nonnegative" CHECK ("amountRial" >= 0)
);
CREATE INDEX "sepidar_dispatch_invoices_loadingId_idx" ON "sepidar_dispatch_invoices"("loadingId");

INSERT INTO "sepidar_dispatch_invoices" ("number", "loadingId")
SELECT "sepidarLoadingReference", "id" FROM "logistics_loadings" WHERE "sepidarLoadingReference" IS NOT NULL;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sabalan_application_runtime' AND rolcanlogin) THEN
    GRANT SELECT, INSERT, DELETE ON public.sepidar_dispatch_invoices TO sabalan_application_runtime;
  END IF;
END
$grant$;

COMMIT;
