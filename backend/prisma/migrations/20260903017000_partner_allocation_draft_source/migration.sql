BEGIN;

ALTER TABLE logistics_allocation_draft_lines
  ADD COLUMN "sourceKind" "PhysicalFulfillmentSourceKind" NOT NULL DEFAULT 'SALES_CONTRACT',
  ADD COLUMN "partnerCaseId" TEXT,
  ADD COLUMN "partnerCaseRevision" INTEGER,
  ADD COLUMN "partnerIntegrityHash" TEXT,
  ADD COLUMN "partnerDeliveryId" TEXT,
  ADD COLUMN "partnerLineageId" TEXT,
  ALTER COLUMN "sourceContractId" DROP NOT NULL,
  ALTER COLUMN "sourceContractItemId" DROP NOT NULL,
  ALTER COLUMN "productId" DROP NOT NULL;

ALTER TABLE logistics_allocation_draft_lines
  ADD CONSTRAINT partner_allocation_draft_source_exclusive CHECK (
    ("sourceKind" = 'SALES_CONTRACT' AND "sourceContractId" IS NOT NULL
      AND "sourceContractItemId" IS NOT NULL AND "productId" IS NOT NULL
      AND "partnerCaseId" IS NULL AND "partnerCaseRevision" IS NULL AND "partnerIntegrityHash" IS NULL
      AND "partnerDeliveryId" IS NULL AND "partnerLineageId" IS NULL)
    OR ("sourceKind" = 'PARTNER_CASE' AND "sourceContractId" IS NULL
      AND "sourceContractItemId" IS NULL AND "productId" IS NULL
      AND "partnerCaseId" IS NOT NULL AND "partnerCaseRevision" IS NOT NULL AND "partnerIntegrityHash" IS NOT NULL
      AND "partnerDeliveryId" IS NOT NULL AND "partnerLineageId" IS NOT NULL AND quantity > 0)),
  ADD CONSTRAINT partner_allocation_draft_revision_owner
    FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerIntegrityHash")
    REFERENCES partner_case_revisions ("caseId", revision, "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_allocation_draft_delivery_row
    FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerDeliveryId", "productRowId")
    REFERENCES partner_case_delivery_items ("caseId", revision, "deliveryId", "productRowId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_allocation_draft_lineage_owner
    FOREIGN KEY ("partnerLineageId", "partnerCaseId", "productRowId", unit)
    REFERENCES partner_fulfillment_lineages (id, "caseId", "productRowId", unit) ON DELETE RESTRICT ON UPDATE NO ACTION;

COMMIT;
