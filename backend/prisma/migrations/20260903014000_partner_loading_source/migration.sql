BEGIN;

ALTER TABLE logistics_loadings
  ADD COLUMN "sourceKind" "PhysicalFulfillmentSourceKind" NOT NULL DEFAULT 'SALES_CONTRACT',
  ADD COLUMN "partnerCaseId" TEXT,
  ADD COLUMN "partnerCaseRevision" INTEGER,
  ADD COLUMN "partnerIntegrityHash" TEXT,
  ADD COLUMN "partnerDeliveryId" TEXT,
  ADD COLUMN "partnerSourceSnapshot" JSONB,
  ADD COLUMN "partnerSourceHash" TEXT,
  ALTER COLUMN "projectId" DROP NOT NULL;

ALTER TABLE partner_sale_cases ADD CONSTRAINT "partner_sale_cases_id_customerId_key" UNIQUE (id, "customerId");
ALTER TABLE logistics_loadings
  ADD CONSTRAINT partner_loading_source_exclusive CHECK (
    ("sourceKind" = 'SALES_CONTRACT' AND "projectId" IS NOT NULL
      AND "partnerCaseId" IS NULL AND "partnerCaseRevision" IS NULL AND "partnerIntegrityHash" IS NULL
      AND "partnerDeliveryId" IS NULL AND "partnerSourceSnapshot" IS NULL AND "partnerSourceHash" IS NULL)
    OR ("sourceKind" = 'PARTNER_CASE' AND "projectId" IS NULL
      AND "partnerCaseId" IS NOT NULL AND "partnerCaseRevision" IS NOT NULL AND "partnerIntegrityHash" IS NOT NULL
      AND "partnerDeliveryId" IS NOT NULL AND "partnerSourceSnapshot" IS NOT NULL
      AND jsonb_typeof("partnerSourceSnapshot") = 'object' AND "partnerSourceHash" IS NOT NULL)),
  ADD CONSTRAINT "logistics_loadings_partnerCaseId_customerId_fkey"
    FOREIGN KEY ("partnerCaseId", "customerId") REFERENCES partner_sale_cases (id, "customerId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_loading_revision_owner
    FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerIntegrityHash")
    REFERENCES partner_case_revisions ("caseId", revision, "integrityHash") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT partner_loading_delivery_owner
    FOREIGN KEY ("partnerCaseId", "partnerCaseRevision", "partnerDeliveryId")
    REFERENCES partner_case_deliveries ("caseId", revision, id) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX partner_loading_delivery_index
  ON logistics_loadings ("partnerCaseId", "partnerCaseRevision", "partnerDeliveryId");

COMMIT;
