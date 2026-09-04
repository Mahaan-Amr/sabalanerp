BEGIN;

ALTER TABLE logistics_allocation_revisions
  ADD COLUMN "partnerCaseId" TEXT,
  ADD COLUMN "partnerCaseRevision" INTEGER,
  ADD COLUMN "partnerIntegrityHash" TEXT,
  ADD COLUMN "partnerInternalRecordId" TEXT,
  ADD COLUMN "partnerDeliveryId" TEXT;

ALTER TABLE logistics_allocation_revisions
  ADD CONSTRAINT partner_allocation_revision_source_exclusive CHECK (
    ("sourceKind" = 'SALES_CONTRACT' AND "partnerCaseId" IS NULL AND "partnerCaseRevision" IS NULL
      AND "partnerIntegrityHash" IS NULL AND "partnerInternalRecordId" IS NULL AND "partnerDeliveryId" IS NULL)
    OR ("sourceKind" = 'PARTNER_CASE' AND "partnerCaseId" IS NOT NULL AND "partnerCaseRevision" IS NOT NULL
      AND "partnerIntegrityHash" IS NOT NULL AND "partnerInternalRecordId" IS NOT NULL AND "partnerDeliveryId" IS NOT NULL)),
  ADD CONSTRAINT partner_allocation_revision_owner FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerIntegrityHash")
    REFERENCES partner_case_revisions ("caseId", revision, "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX partner_allocation_revision_case_index ON logistics_allocation_revisions ("partnerCaseId", "partnerCaseRevision");

ALTER TABLE logistics_allocation_revision_lines
  ADD COLUMN "sourceKind" "PhysicalFulfillmentSourceKind" NOT NULL DEFAULT 'SALES_CONTRACT',
  ADD COLUMN "partnerCaseId" TEXT,
  ADD COLUMN "partnerCaseRevision" INTEGER,
  ADD COLUMN "partnerIntegrityHash" TEXT,
  ADD COLUMN "partnerDeliveryId" TEXT,
  ADD COLUMN "partnerLineageId" TEXT,
  ALTER COLUMN "sourceContractId" DROP NOT NULL,
  ALTER COLUMN "sourceContractItemId" DROP NOT NULL,
  ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE logistics_allocation_revision_lines
  ADD CONSTRAINT partner_allocation_line_source_exclusive CHECK (
    ("sourceKind" = 'SALES_CONTRACT' AND "sourceContractId" IS NOT NULL AND "sourceContractItemId" IS NOT NULL
      AND "productId" IS NOT NULL AND "partnerCaseId" IS NULL AND "partnerCaseRevision" IS NULL
      AND "partnerIntegrityHash" IS NULL AND "partnerDeliveryId" IS NULL AND "partnerLineageId" IS NULL)
    OR ("sourceKind" = 'PARTNER_CASE' AND "sourceContractId" IS NULL AND "sourceContractItemId" IS NULL
      AND "productId" IS NULL AND "partnerCaseId" IS NOT NULL AND "partnerCaseRevision" IS NOT NULL
      AND "partnerIntegrityHash" IS NOT NULL AND "partnerDeliveryId" IS NOT NULL AND "partnerLineageId" IS NOT NULL)),
  ADD CONSTRAINT partner_allocation_line_revision_owner FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerIntegrityHash")
    REFERENCES partner_case_revisions ("caseId", revision, "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_allocation_line_delivery_row FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerDeliveryId", "productRowId")
    REFERENCES partner_case_delivery_items ("caseId", revision, "deliveryId", "productRowId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_allocation_line_lineage_owner FOREIGN KEY ("partnerLineageId", "partnerCaseId", "productRowId", unit)
    REFERENCES partner_fulfillment_lineages (id, "caseId", "productRowId", unit) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX partner_allocation_line_case_index ON logistics_allocation_revision_lines ("partnerCaseId", "productRowId");

CREATE TABLE partner_allocation_revision_pricing (
  id TEXT PRIMARY KEY,
  "allocationRevisionId" TEXT NOT NULL UNIQUE,
  "caseId" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "internalRecordId" TEXT NOT NULL,
  "sourceFinancialRecordId" TEXT NOT NULL,
  "financialApprovalEvidenceId" TEXT NOT NULL,
  "preparationEvidenceHash" TEXT NOT NULL,
  "readinessEvidenceHash" TEXT NOT NULL,
  currency TEXT NOT NULL,
  "grossAmount" NUMERIC(38,12) NOT NULL,
  "discountAmount" NUMERIC(38,12) NOT NULL,
  "netAmount" NUMERIC(38,12) NOT NULL,
  "pricingIntegrityHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT partner_allocation_pricing_revision_fkey FOREIGN KEY ("allocationRevisionId") REFERENCES logistics_allocation_revisions(id) ON DELETE RESTRICT,
  CONSTRAINT partner_allocation_pricing_revision_owner FOREIGN KEY ("caseId", "caseRevision", "integrityHash")
    REFERENCES partner_case_revisions ("caseId", revision, "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT partner_allocation_pricing_internal_owner FOREIGN KEY ("internalRecordId", "caseId")
    REFERENCES sabalan_to_partner_sale_records (id, "caseId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT partner_allocation_pricing_financial_fkey FOREIGN KEY ("sourceFinancialRecordId")
    REFERENCES accounting_financial_records(id) ON DELETE RESTRICT,
  CONSTRAINT partner_allocation_pricing_amounts CHECK ("grossAmount" >= 0 AND "discountAmount" >= 0
    AND "netAmount" = "grossAmount" - "discountAmount")
);
CREATE UNIQUE INDEX partner_allocation_pricing_revision_case_key ON partner_allocation_revision_pricing ("allocationRevisionId", "caseId");
CREATE INDEX partner_allocation_pricing_case_index ON partner_allocation_revision_pricing ("caseId", "caseRevision");

CREATE TABLE partner_priced_allocation_events (
  id TEXT PRIMARY KEY,
  "allocationRevisionLineId" TEXT NOT NULL UNIQUE,
  "pricingReferenceId" TEXT NOT NULL,
  "approvalEvidenceId" TEXT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL,
  "grossAmount" NUMERIC(38,12) NOT NULL,
  "discountAmount" NUMERIC(38,12) NOT NULL,
  "netAmount" NUMERIC(38,12) NOT NULL,
  "consumesFinalRemainder" BOOLEAN NOT NULL,
  evidence JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL UNIQUE,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT partner_priced_allocation_line_fkey FOREIGN KEY ("allocationRevisionLineId")
    REFERENCES logistics_allocation_revision_lines(id) ON DELETE RESTRICT,
  CONSTRAINT partner_priced_allocation_reference_fkey FOREIGN KEY ("pricingReferenceId")
    REFERENCES partner_allocation_revision_pricing(id) ON DELETE RESTRICT,
  CONSTRAINT partner_priced_allocation_amounts CHECK (quantity <> 0 AND "netAmount" = "grossAmount" - "discountAmount")
);
CREATE INDEX partner_priced_allocation_reference_index ON partner_priced_allocation_events ("pricingReferenceId", "recordedAt");
CREATE INDEX partner_priced_allocation_approval_index ON partner_priced_allocation_events ("approvalEvidenceId", "recordedAt");

COMMIT;
