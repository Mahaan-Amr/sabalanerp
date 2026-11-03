-- Historical contracts can have a complete frozen Product Graph but no
-- ContractItem rows. contractItemId is an immutable source-evidence identity,
-- not necessarily a live commercial row. Keep it required for audit identity,
-- but do not invent or insert a ContractItem merely to satisfy an FK.
ALTER TABLE "contract_approved_pricing_rows"
  DROP CONSTRAINT IF EXISTS "approved_pricing_row_contract_item_fk";

ALTER TABLE "contract_approved_pricing_rows"
  ADD COLUMN "linkedContractItemId" TEXT;

DROP TRIGGER "approved_pricing_row_immutable" ON "contract_approved_pricing_rows";

UPDATE "contract_approved_pricing_rows"
  SET "linkedContractItemId" = "contractItemId";

CREATE TRIGGER "approved_pricing_row_immutable"
  BEFORE UPDATE OR DELETE ON "contract_approved_pricing_rows"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();

CREATE INDEX "approved_pricing_row_linked_contract_item_idx"
  ON "contract_approved_pricing_rows"("linkedContractItemId");

ALTER TABLE "contract_approved_pricing_rows"
  ADD CONSTRAINT "approved_pricing_row_live_contract_item_fk"
  FOREIGN KEY ("linkedContractItemId") REFERENCES "contract_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

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
DECLARE version_evidence JSONB;
DECLARE legacy_identity_compatible BOOLEAN;
DECLARE recovered_identity_compatible BOOLEAN;
DECLARE rebound_identity_compatible BOOLEAN;
DECLARE linked_contract TEXT;
DECLARE linked_product_row TEXT;
BEGIN
  IF TG_TABLE_NAME = 'contract_approved_pricing_heads' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."currentVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'pricing head and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'contract_approved_pricing_rows' THEN
    SELECT "contractId", "sourceEvidence" INTO expected_contract, version_evidence
      FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    SELECT "contractId", "productRowId" INTO related_contract, related_product_row
      FROM "contract_items" WHERE "id" = NEW."contractItemId";

    IF related_contract IS NULL THEN
      IF NEW."linkedContractItemId" IS NOT NULL THEN
        SELECT "contractId", "productRowId" INTO linked_contract, linked_product_row
          FROM "contract_items" WHERE "id" = NEW."linkedContractItemId";
        SELECT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(
            version_evidence #> '{graph,compatibility,liveContractItemRebindings}', '[]'::jsonb
          )) rebound
          WHERE rebound->>'sourceContractItemId' = NEW."contractItemId"
            AND rebound->>'linkedContractItemId' = NEW."linkedContractItemId"
            AND rebound->>'productRowId' = NEW."productRowId"
            AND rebound->>'rule' = 'FROZEN_STABLE_PRODUCT_ROW_LIVE_ITEM_REBINDING_V1'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(
                version_evidence #> '{financialApproval,invoiceItems}', '[]'::jsonb
              )) invoice_item
              WHERE invoice_item->>'id' = rebound->>'invoiceItemId'
                AND invoice_item->>'contractItemId' = NEW."contractItemId"
            )
        ) AND EXISTS (
          SELECT 1 FROM "sales_contract_product_graph_audits" audit
          WHERE audit."commandId" = version_evidence #>> '{graph,compatibility,migrationAuditCommandId}'
            AND audit."contractId" = expected_contract
            AND audit."command"->>'kind' IN ('legacy-migration', 'canonical-wizard-save')
            AND audit."inputHash" = version_evidence #>> '{graph,inputHash}'
            AND audit."resultHash" = version_evidence #>> '{graph,resultHash}'
        ) INTO rebound_identity_compatible;
        IF linked_contract IS DISTINCT FROM expected_contract OR
          linked_product_row IS DISTINCT FROM NEW."productRowId" OR
          NOT rebound_identity_compatible THEN
          RAISE EXCEPTION 'pricing row live rebinding lacks deterministic frozen evidence';
        END IF;
      ELSE
        SELECT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(
          version_evidence #> '{graph,compatibility,recoveredAccountingRows}', '[]'::jsonb
        )) recovered
        WHERE recovered->>'contractItemId' = NEW."contractItemId"
          AND recovered->>'productRowId' = NEW."productRowId"
          AND recovered->>'rule' = 'FROZEN_GRAPH_ROW_ACCOUNTING_EVIDENCE_V1'
      ) AND EXISTS (
        SELECT 1 FROM "sales_contract_product_graph_audits" audit
        WHERE audit."commandId" = version_evidence #>> '{graph,compatibility,migrationAuditCommandId}'
          AND audit."contractId" = expected_contract
          AND audit."command"->>'kind' = 'legacy-migration'
          AND audit."inputHash" = version_evidence #>> '{graph,inputHash}'
          AND audit."resultHash" = version_evidence #>> '{graph,resultHash}'
        ) INTO recovered_identity_compatible;
        IF NOT recovered_identity_compatible THEN
          RAISE EXCEPTION 'pricing row missing contract item lacks deterministic recovery evidence';
        END IF;
      END IF;
    ELSE
      IF NEW."linkedContractItemId" IS DISTINCT FROM NEW."contractItemId" THEN
        RAISE EXCEPTION 'live pricing row link must equal its source contract item identity';
      END IF;
      IF expected_contract IS DISTINCT FROM related_contract THEN RAISE EXCEPTION 'pricing row and contract item contracts differ'; END IF;
      legacy_identity_compatible := FALSE;
      IF related_product_row IS NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(
            version_evidence #> '{graph,compatibility,rowIdentityAssignments}', '[]'::jsonb
          )) assignment
          WHERE assignment->>'contractItemId' = NEW."contractItemId"
            AND assignment->>'productRowId' = NEW."productRowId"
            AND assignment->>'rule' = 'MIGRATED_GRAPH_ORDINAL_PRODUCT_IDENTITY_V1'
        ) AND EXISTS (
          SELECT 1 FROM "sales_contract_product_graph_audits" audit
          WHERE audit."commandId" = version_evidence #>> '{graph,compatibility,migrationAuditCommandId}'
            AND audit."contractId" = expected_contract
            AND audit."command"->>'kind' = 'legacy-migration'
            AND audit."inputHash" = version_evidence #>> '{graph,inputHash}'
            AND audit."resultHash" = version_evidence #>> '{graph,resultHash}'
        ) INTO legacy_identity_compatible;
      END IF;
      IF related_product_row IS DISTINCT FROM NEW."productRowId" AND NOT legacy_identity_compatible THEN
        RAISE EXCEPTION 'pricing row stable product identity differs from contract item';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'logistics_allocation_revision_pricing' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'allocation pricing reference and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_priced_allocation_events' THEN
    SELECT r."pricingVersionId", COALESCE(r."linkedContractItemId", r."contractItemId"), r."productRowId", v."contractId"
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
