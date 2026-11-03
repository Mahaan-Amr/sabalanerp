CREATE TYPE "ShipmentQuantityEvidenceKind" AS ENUM ('CONTRACTED_SET', 'ALLOCATION_FINALIZED', 'ALLOCATION_RELEASED', 'PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT', 'DISPATCH_CORRECTION_DRAFT', 'DISPATCH_CORRECTION_POSTED', 'LEGACY_UNRECONCILED_RESERVED', 'LEGACY_DISPATCHED', 'LEGACY_RELEASED', 'LEGACY_STILL_RESERVED', 'PROJECTION_STALE', 'EVIDENCE_CONFLICT');
CREATE TYPE "ShipmentProjectionHealth" AS ENUM ('CURRENT', 'STALE', 'LEGACY_UNRECONCILED', 'EVIDENCE_CONFLICT');

CREATE TABLE "shipment_quantity_evidence" (
  "id" TEXT NOT NULL, "contractId" TEXT NOT NULL, "contractItemId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL, "unit" TEXT NOT NULL, "kind" "ShipmentQuantityEvidenceKind" NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL, "sourceVersion" INTEGER NOT NULL DEFAULT 1, "integrityHash" TEXT NOT NULL,
  "metadata" JSONB, CONSTRAINT "shipment_quantity_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shipment_quantity_projections" (
  "contractItemId" TEXT NOT NULL, "contractId" TEXT NOT NULL, "productRowId" TEXT NOT NULL,
  "unit" TEXT NOT NULL, "contracted" DECIMAL(18,3), "finalizedReserved" DECIMAL(18,3),
  "physicallyDispatched" DECIMAL(18,3), "availableToLoad" DECIMAL(18,3),
  "health" "ShipmentProjectionHealth" NOT NULL, "healthReasons" JSONB NOT NULL,
  "sourceEvidenceIds" JSONB NOT NULL, "cutoff" TIMESTAMP(3) NOT NULL,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastVerifiedAt" TIMESTAMP(3),
  "integrityHash" TEXT NOT NULL, CONSTRAINT "shipment_quantity_projections_pkey" PRIMARY KEY ("contractItemId")
);

CREATE UNIQUE INDEX "shipment_quantity_evidence_sourceType_sourceId_sourceVersion_key" ON "shipment_quantity_evidence"("sourceType", "sourceId", "sourceVersion");
CREATE INDEX "shipment_quantity_evidence_contractId_effectiveAt_idx" ON "shipment_quantity_evidence"("contractId", "effectiveAt");
CREATE INDEX "shipment_quantity_evidence_contractItemId_effectiveAt_idx" ON "shipment_quantity_evidence"("contractItemId", "effectiveAt");
CREATE INDEX "shipment_quantity_evidence_recordedAt_idx" ON "shipment_quantity_evidence"("recordedAt");
CREATE INDEX "shipment_quantity_projections_contractId_idx" ON "shipment_quantity_projections"("contractId");
CREATE INDEX "shipment_quantity_projections_health_idx" ON "shipment_quantity_projections"("health");
ALTER TABLE "shipment_quantity_evidence" ADD CONSTRAINT "shipment_quantity_evidence_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_quantity_evidence" ADD CONSTRAINT "shipment_quantity_evidence_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_quantity_projections" ADD CONSTRAINT "shipment_quantity_projections_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_quantity_projections" ADD CONSTRAINT "shipment_quantity_projections_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
