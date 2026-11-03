-- Require callers to state immutable business evidence explicitly.
ALTER TABLE "contract_approved_pricing_versions" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "dispatch_priced_allocation_events" ALTER COLUMN "consumesFinalRemainder" DROP DEFAULT;
ALTER TABLE "shipment_statement_migration_runs" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "shipment_statement_cutovers"
  ADD CONSTRAINT "shipment_statement_cutover_manifest_fk"
  FOREIGN KEY ("manifestId") REFERENCES "shipment_statement_migration_manifests"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
