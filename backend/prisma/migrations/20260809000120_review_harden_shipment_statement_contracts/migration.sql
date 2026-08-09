-- Review hardening for stable row identity, posted adjustments, replacement history, and typed commands.

CREATE TYPE "DispatchDocumentCommandScope" AS ENUM ('CANDIDATE', 'WAYBILL', 'CORRECTION', 'PRINT_HANDOFF');

ALTER TABLE "dispatch_document_command_results"
  ALTER COLUMN "scope" TYPE "DispatchDocumentCommandScope"
  USING "scope"::text::"DispatchDocumentCommandScope";

ALTER TABLE "dispatch_document_command_results"
  ADD CONSTRAINT "dispatch_document_command_scope_identity_valid" CHECK (
    ("scope" = 'CANDIDATE' AND "waybillId" IS NULL)
    OR ("scope" = 'WAYBILL' AND "waybillId" = "scopeId")
    OR ("scope" IN ('CORRECTION', 'PRINT_HANDOFF') AND "waybillId" IS NOT NULL)
  );

-- A checksum verifies bytes; it is not a global document identity. Replacement bundles are unique per successor waybill.
ALTER TABLE "dispatch_document_artifacts" DROP CONSTRAINT "dispatch_document_artifacts_sha256_key";
CREATE INDEX "dispatch_document_artifact_sha256_idx" ON "dispatch_document_artifacts" ("sha256");

CREATE OR REPLACE FUNCTION validate_approved_pricing_graph() RETURNS trigger AS $$
DECLARE expected_contract TEXT;
DECLARE related_contract TEXT;
DECLARE expected_product_row TEXT;
DECLARE related_product_row TEXT;
DECLARE expected_contract_item TEXT;
DECLARE correction_status TEXT;
DECLARE correction_posted_at TIMESTAMP(3);
DECLARE line_revision_id TEXT;
DECLARE line_contract_id TEXT;
DECLARE line_item_id TEXT;
DECLARE line_product_row_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'contract_approved_pricing_heads' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."currentVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'pricing head and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'contract_approved_pricing_rows' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    SELECT "contractId", "productRowId" INTO related_contract, related_product_row FROM "contract_items" WHERE "id" = NEW."contractItemId";
    IF expected_contract IS DISTINCT FROM related_contract THEN RAISE EXCEPTION 'pricing row and contract item contracts differ'; END IF;
    IF related_product_row IS NULL OR related_product_row IS DISTINCT FROM NEW."productRowId" THEN RAISE EXCEPTION 'pricing row stable product identity differs from contract item'; END IF;
  ELSIF TG_TABLE_NAME = 'logistics_allocation_revision_pricing' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'allocation pricing reference and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_priced_allocation_events' THEN
    SELECT r."pricingVersionId", r."contractItemId", r."productRowId", v."contractId"
      INTO related_contract, expected_contract_item, expected_product_row, expected_contract
      FROM "contract_approved_pricing_rows" r
      JOIN "contract_approved_pricing_versions" v ON v."id" = r."pricingVersionId"
      WHERE r."id" = NEW."pricingRowId";
    IF related_contract IS DISTINCT FROM NEW."pricingVersionId" THEN RAISE EXCEPTION 'priced event row and version differ'; END IF;

    SELECT "revisionId", "sourceContractId", "sourceContractItemId", "productRowId"
      INTO line_revision_id, line_contract_id, line_item_id, line_product_row_id
      FROM "logistics_allocation_revision_lines" WHERE "id" = NEW."allocationRevisionLineId";
    IF line_revision_id IS DISTINCT FROM NEW."allocationRevisionId" THEN RAISE EXCEPTION 'priced event line and revision differ'; END IF;
    IF line_contract_id IS DISTINCT FROM expected_contract THEN RAISE EXCEPTION 'priced event source contract differs from approved pricing'; END IF;
    IF line_item_id IS DISTINCT FROM expected_contract_item THEN RAISE EXCEPTION 'priced event source contract item differs from approved pricing row'; END IF;
    IF line_product_row_id IS DISTINCT FROM expected_product_row THEN RAISE EXCEPTION 'priced event stable product identity differs from approved pricing row'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "logistics_allocation_revision_pricing" p
      WHERE p."allocationRevisionId" = NEW."allocationRevisionId"
        AND p."contractId" = expected_contract
        AND p."pricingVersionId" = NEW."pricingVersionId"
    ) THEN RAISE EXCEPTION 'priced event has no matching allocation pricing reference'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_statement_adjustments' THEN
    SELECT "waybillId", "status"::text, "postedAt" INTO related_contract, correction_status, correction_posted_at
      FROM "dispatch_corrections" WHERE "id" = NEW."correctionId";
    IF related_contract IS DISTINCT FROM NEW."waybillId" THEN RAISE EXCEPTION 'statement adjustment and correction waybills differ'; END IF;
    IF correction_status IS DISTINCT FROM 'POSTED' OR correction_posted_at IS NULL THEN RAISE EXCEPTION 'statement adjustment requires a posted correction'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_document_artifacts' AND NEW."statementAdjustmentId" IS NOT NULL THEN
    SELECT "waybillId" INTO related_contract FROM "dispatch_statement_adjustments" WHERE "id" = NEW."statementAdjustmentId";
    IF related_contract IS DISTINCT FROM NEW."waybillId" THEN RAISE EXCEPTION 'adjustment artifact and adjustment waybills differ'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON INDEX "dispatch_artifact_one_waybill" IS 'One immutable waybill artifact per AccountingDispatchWaybill, including each replacement waybill.';
COMMENT ON INDEX "dispatch_artifact_one_statement" IS 'One immutable statement artifact per AccountingDispatchWaybill, including each replacement waybill.';
