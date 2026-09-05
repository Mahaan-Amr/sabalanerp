-- Existing shipment evidence remains ordinary and keeps its immutable bytes/hash.
-- Partner evidence uses the same ledger and return constraints, with explicit
-- Case/lineage ownership instead of a fabricated customer ContractItem.
ALTER TABLE "partner_case_revisions" ADD CONSTRAINT "partner_revision_exact_shipment_owner"
  UNIQUE ("caseId", "revision", "integrityHash");
ALTER TABLE "partner_fulfillment_lineages" ADD CONSTRAINT "partner_lineage_shipment_identity"
  UNIQUE ("id", "caseId", "productRowId", "unit");
ALTER TABLE "shipment_quantity_evidence"
  ADD COLUMN "sourceKind" "PhysicalFulfillmentSourceKind" NOT NULL DEFAULT 'SALES_CONTRACT',
  ADD COLUMN "partnerLineageId" TEXT,
  ADD COLUMN "partnerCaseId" TEXT,
  ADD COLUMN "partnerCaseRevision" INTEGER,
  ADD COLUMN "partnerIntegrityHash" TEXT,
  ALTER COLUMN "contractId" DROP NOT NULL,
  ALTER COLUMN "contractItemId" DROP NOT NULL,
  ADD CONSTRAINT "shipment_quantity_source_identity" CHECK (
    ("sourceKind" = 'SALES_CONTRACT' AND "contractId" IS NOT NULL AND "contractItemId" IS NOT NULL
      AND "partnerLineageId" IS NULL AND "partnerCaseId" IS NULL AND "partnerCaseRevision" IS NULL AND "partnerIntegrityHash" IS NULL)
    OR
    ("sourceKind" = 'PARTNER_CASE' AND "contractId" IS NULL AND "contractItemId" IS NULL
      AND "partnerLineageId" IS NOT NULL AND "partnerCaseId" IS NOT NULL AND "partnerCaseRevision" IS NOT NULL AND "partnerIntegrityHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "shipment_quantity_partner_lineage"
    FOREIGN KEY ("partnerLineageId", "partnerCaseId", "productRowId", "unit")
    REFERENCES "partner_fulfillment_lineages" ("id", "caseId", "productRowId", "unit") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "shipment_quantity_partner_revision"
    FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerIntegrityHash")
    REFERENCES "partner_case_revisions" ("caseId", "revision", "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "shipment_quantity_partner_return_once"
  ON "shipment_quantity_evidence" ("guardReturnMovementId", "partnerLineageId", "dispatchEvidenceId");
CREATE INDEX "shipment_quantity_evidence_partnerCaseId_effectiveAt_idx"
  ON "shipment_quantity_evidence" ("partnerCaseId", "effectiveAt");
