CREATE TABLE "legacy_waybill_reconstructions" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT NOT NULL UNIQUE REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT,
  "allocationRevisionId" TEXT NOT NULL REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT,
  "sourceIntegrityHash" TEXT NOT NULL CHECK ("sourceIntegrityHash" ~ '^[a-f0-9]{64}$'),
  "waybillIntegrityHash" TEXT NOT NULL CHECK ("waybillIntegrityHash" ~ '^[a-f0-9]{64}$'),
  "pdfSha256" TEXT NOT NULL CHECK ("pdfSha256" ~ '^[a-f0-9]{64}$'),
  "pdf" BYTEA NOT NULL CHECK (octet_length("pdf") > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) >= 3)
);
CREATE TRIGGER legacy_waybill_reconstruction_immutable BEFORE UPDATE OR DELETE ON "legacy_waybill_reconstructions"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
