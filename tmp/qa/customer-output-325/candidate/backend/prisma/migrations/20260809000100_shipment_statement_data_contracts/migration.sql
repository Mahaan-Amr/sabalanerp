-- Customer Shipment Statement persistence foundation.
-- This migration is intentionally additive: it does not update or remove legacy evidence.

CREATE TYPE "ApprovedPricingVersionOrigin" AS ENUM ('FINANCIAL_APPROVAL', 'LEGACY_SEAL');
CREATE TYPE "PricingReadinessStatus" AS ENUM ('READY', 'BLOCKED', 'QUARANTINED');
CREATE TYPE "PricingReadinessReasonCode" AS ENUM (
  'MISSING_FINANCIAL_APPROVAL', 'MISSING_STABLE_ROW_IDENTITY', 'MISSING_CURRENCY',
  'MISSING_CONTRACTED_QUANTITY', 'MISSING_CANONICAL_ROW_TOTAL', 'MISSING_DISCOUNT_EVIDENCE',
  'ROW_IDENTITY_CONFLICT', 'CURRENCY_CONFLICT', 'SOURCE_HASH_MISMATCH', 'SOURCE_EVIDENCE_INCOMPLETE'
);
CREATE TYPE "DispatchDocumentKind" AS ENUM ('WAYBILL', 'STATEMENT', 'STATEMENT_ADJUSTMENT');
CREATE TYPE "DispatchPrintHandoffStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "DispatchDocumentCommandType" AS ENUM (
  'ACCEPT_AND_ISSUE', 'REJECT', 'VOID', 'REPLACE', 'RETRIEVE', 'PRINT_HANDOFF', 'ISSUE_ADJUSTMENT'
);
CREATE TYPE "DispatchDocumentCommandStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');
CREATE TYPE "MigrationRunStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');
CREATE TYPE "MigrationEvidenceOutcome" AS ENUM ('MATCHED', 'QUARANTINED', 'FAILED');

CREATE TABLE "contract_approved_pricing_versions" (
  "id" TEXT PRIMARY KEY,
  "contractId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sourceFinancialRecordId" TEXT NOT NULL,
  "origin" "ApprovedPricingVersionOrigin" NOT NULL DEFAULT 'FINANCIAL_APPROVAL',
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "grossAmount" DECIMAL(38,12) NOT NULL,
  "discountAmount" DECIMAL(38,12) NOT NULL,
  "netAmount" DECIMAL(38,12) NOT NULL,
  "sourceEvidence" JSONB NOT NULL,
  "legacySourceReference" JSONB,
  "integrityHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approved_pricing_version_number_positive" CHECK ("versionNumber" > 0),
  CONSTRAINT "approved_pricing_schema_version_positive" CHECK ("schemaVersion" > 0),
  CONSTRAINT "approved_pricing_amounts_valid" CHECK (
    "grossAmount" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0
    AND "grossAmount" - "discountAmount" = "netAmount"
  ),
  CONSTRAINT "approved_pricing_legacy_reference_valid" CHECK (
    ("origin" = 'LEGACY_SEAL' AND "legacySourceReference" IS NOT NULL)
    OR ("origin" = 'FINANCIAL_APPROVAL' AND "legacySourceReference" IS NULL)
  ),
  CONSTRAINT "approved_pricing_integrity_hash_sha256" CHECK ("integrityHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "approved_pricing_version_contract_number_key" ON "contract_approved_pricing_versions" ("contractId", "versionNumber");
CREATE UNIQUE INDEX "approved_pricing_version_source_contract_key" ON "contract_approved_pricing_versions" ("sourceFinancialRecordId", "contractId");
CREATE UNIQUE INDEX "approved_pricing_version_integrity_hash_key" ON "contract_approved_pricing_versions" ("integrityHash");
CREATE INDEX "approved_pricing_version_contract_approved_idx" ON "contract_approved_pricing_versions" ("contractId", "approvedAt");

CREATE TABLE "contract_approved_pricing_rows" (
  "id" TEXT PRIMARY KEY,
  "pricingVersionId" TEXT NOT NULL,
  "contractItemId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "contractedQuantity" DECIMAL(18,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "canonicalAllInTotal" DECIMAL(38,12) NOT NULL,
  "discountEligible" BOOLEAN NOT NULL,
  "componentEvidence" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL,
  CONSTRAINT "approved_pricing_row_ordinal_positive" CHECK ("ordinal" > 0),
  CONSTRAINT "approved_pricing_row_quantity_positive" CHECK ("contractedQuantity" > 0),
  CONSTRAINT "approved_pricing_row_total_nonnegative" CHECK ("canonicalAllInTotal" >= 0),
  CONSTRAINT "approved_pricing_row_integrity_hash_sha256" CHECK ("integrityHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "approved_pricing_row_version_ordinal_key" ON "contract_approved_pricing_rows" ("pricingVersionId", "ordinal");
CREATE UNIQUE INDEX "approved_pricing_row_version_item_key" ON "contract_approved_pricing_rows" ("pricingVersionId", "contractItemId");
CREATE UNIQUE INDEX "approved_pricing_row_version_product_row_key" ON "contract_approved_pricing_rows" ("pricingVersionId", "productRowId");
CREATE UNIQUE INDEX "approved_pricing_row_integrity_hash_key" ON "contract_approved_pricing_rows" ("integrityHash");
CREATE INDEX "approved_pricing_row_contract_item_idx" ON "contract_approved_pricing_rows" ("contractItemId");

CREATE TABLE "contract_approved_pricing_heads" (
  "contractId" TEXT PRIMARY KEY,
  "currentVersionId" TEXT NOT NULL UNIQUE,
  "advancedAt" TIMESTAMP(3) NOT NULL,
  "advancedBy" TEXT NOT NULL
);

CREATE TABLE "contract_pricing_readiness_results" (
  "id" TEXT PRIMARY KEY,
  "contractId" TEXT NOT NULL,
  "pricingVersionId" TEXT,
  "sourceFinancialRecordId" TEXT,
  "status" "PricingReadinessStatus" NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "sourceIdentityHash" TEXT NOT NULL,
  "quantityTotal" DECIMAL(38,3),
  "amountTotal" DECIMAL(38,12),
  "evidenceHash" TEXT NOT NULL UNIQUE,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedBy" TEXT NOT NULL,
  CONSTRAINT "pricing_readiness_source_count_nonnegative" CHECK ("sourceCount" >= 0),
  CONSTRAINT "pricing_readiness_ready_complete" CHECK (
    "status" <> 'READY' OR (
      "pricingVersionId" IS NOT NULL AND "sourceFinancialRecordId" IS NOT NULL
      AND "quantityTotal" IS NOT NULL AND "amountTotal" IS NOT NULL
    )
  ),
  CONSTRAINT "pricing_readiness_hashes_sha256" CHECK (
    "sourceIdentityHash" ~ '^[0-9a-f]{64}$' AND "evidenceHash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE INDEX "pricing_readiness_contract_evaluated_idx" ON "contract_pricing_readiness_results" ("contractId", "evaluatedAt");
CREATE INDEX "pricing_readiness_status_evaluated_idx" ON "contract_pricing_readiness_results" ("status", "evaluatedAt");

CREATE TABLE "contract_pricing_readiness_reasons" (
  "id" TEXT PRIMARY KEY,
  "readinessResultId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "code" "PricingReadinessReasonCode" NOT NULL,
  "detail" JSONB NOT NULL,
  CONSTRAINT "pricing_readiness_reason_ordinal_positive" CHECK ("ordinal" > 0)
);
CREATE UNIQUE INDEX "pricing_readiness_reason_result_ordinal_key" ON "contract_pricing_readiness_reasons" ("readinessResultId", "ordinal");
CREATE INDEX "pricing_readiness_reason_code_idx" ON "contract_pricing_readiness_reasons" ("code");

CREATE TABLE "logistics_allocation_revision_pricing" (
  "id" TEXT PRIMARY KEY,
  "allocationRevisionId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "pricingVersionId" TEXT NOT NULL,
  "expectedPricingHash" TEXT NOT NULL,
  "readinessEvidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "allocation_pricing_hashes_sha256" CHECK (
    "expectedPricingHash" ~ '^[0-9a-f]{64}$' AND "readinessEvidenceHash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "allocation_revision_pricing_contract_key" ON "logistics_allocation_revision_pricing" ("allocationRevisionId", "contractId");
CREATE UNIQUE INDEX "allocation_revision_pricing_version_key" ON "logistics_allocation_revision_pricing" ("allocationRevisionId", "pricingVersionId");
CREATE INDEX "allocation_revision_pricing_version_idx" ON "logistics_allocation_revision_pricing" ("pricingVersionId");

CREATE TABLE "dispatch_priced_allocation_events" (
  "id" TEXT PRIMARY KEY,
  "allocationRevisionId" TEXT NOT NULL,
  "allocationRevisionLineId" TEXT NOT NULL UNIQUE,
  "pricingVersionId" TEXT NOT NULL,
  "pricingRowId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "grossAmount" DECIMAL(38,12) NOT NULL,
  "discountAmount" DECIMAL(38,12) NOT NULL,
  "netAmount" DECIMAL(38,12) NOT NULL,
  "consumesFinalRemainder" BOOLEAN NOT NULL DEFAULT false,
  "evidence" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL UNIQUE,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "priced_allocation_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "priced_allocation_amounts_valid" CHECK (
    "grossAmount" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0
    AND "grossAmount" - "discountAmount" = "netAmount"
  ),
  CONSTRAINT "priced_allocation_integrity_hash_sha256" CHECK ("integrityHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "priced_allocation_pricing_row_recorded_idx" ON "dispatch_priced_allocation_events" ("pricingRowId", "recordedAt");
CREATE INDEX "priced_allocation_revision_idx" ON "dispatch_priced_allocation_events" ("allocationRevisionId");

CREATE TABLE "dispatch_statement_adjustments" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT NOT NULL,
  "correctionId" TEXT NOT NULL UNIQUE,
  "sequence" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL UNIQUE,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedBy" TEXT NOT NULL,
  CONSTRAINT "statement_adjustment_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "statement_adjustment_integrity_hash_sha256" CHECK ("integrityHash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "statement_adjustment_waybill_sequence_key" ON "dispatch_statement_adjustments" ("waybillId", "sequence");
CREATE INDEX "statement_adjustment_waybill_issued_idx" ON "dispatch_statement_adjustments" ("waybillId", "issuedAt");

CREATE TABLE "dispatch_document_artifacts" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT NOT NULL,
  "kind" "DispatchDocumentKind" NOT NULL,
  "statementAdjustmentId" TEXT UNIQUE,
  "templateVersion" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "mediaType" TEXT NOT NULL,
  "byteLength" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL UNIQUE,
  "sourceIntegrityHash" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedBy" TEXT NOT NULL,
  CONSTRAINT "dispatch_artifact_kind_cardinality" CHECK (
    ("kind" = 'STATEMENT_ADJUSTMENT' AND "statementAdjustmentId" IS NOT NULL)
    OR ("kind" IN ('WAYBILL', 'STATEMENT') AND "statementAdjustmentId" IS NULL)
  ),
  CONSTRAINT "dispatch_artifact_pdf_nonempty" CHECK ("mediaType" = 'application/pdf' AND "byteLength" > 0),
  CONSTRAINT "dispatch_artifact_hashes_sha256" CHECK (
    "sha256" ~ '^[0-9a-f]{64}$' AND "sourceIntegrityHash" ~ '^[0-9a-f]{64}$'
  )
);
CREATE UNIQUE INDEX "dispatch_artifact_one_waybill" ON "dispatch_document_artifacts" ("waybillId") WHERE "kind" = 'WAYBILL';
CREATE UNIQUE INDEX "dispatch_artifact_one_statement" ON "dispatch_document_artifacts" ("waybillId") WHERE "kind" = 'STATEMENT';
CREATE INDEX "dispatch_artifact_waybill_kind_published_idx" ON "dispatch_document_artifacts" ("waybillId", "kind", "publishedAt");

CREATE TABLE "dispatch_document_print_handoffs" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "status" "DispatchPrintHandoffStatus" NOT NULL,
  "requestedKinds" "DispatchDocumentKind"[] NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requestedBy" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "failureDetail" JSONB,
  "correlationId" TEXT NOT NULL,
  CONSTRAINT "print_handoff_requested_kinds_nonempty" CHECK (cardinality("requestedKinds") > 0),
  CONSTRAINT "print_handoff_completion_state_valid" CHECK (
    ("status" = 'PENDING' AND "completedAt" IS NULL AND "failureCode" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "failureCode" IS NULL)
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
  )
);
CREATE INDEX "print_handoff_waybill_requested_idx" ON "dispatch_document_print_handoffs" ("waybillId", "requestedAt");
CREATE INDEX "print_handoff_status_requested_idx" ON "dispatch_document_print_handoffs" ("status", "requestedAt");

CREATE TABLE "dispatch_document_print_handoff_items" (
  "id" TEXT PRIMARY KEY,
  "handoffId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "byteLength" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  CONSTRAINT "print_handoff_item_ordinal_positive" CHECK ("ordinal" > 0),
  CONSTRAINT "print_handoff_item_bytes_positive" CHECK ("byteLength" > 0),
  CONSTRAINT "print_handoff_item_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "print_handoff_item_handoff_ordinal_key" ON "dispatch_document_print_handoff_items" ("handoffId", "ordinal");
CREATE UNIQUE INDEX "print_handoff_item_handoff_artifact_key" ON "dispatch_document_print_handoff_items" ("handoffId", "artifactId");

CREATE TABLE "dispatch_document_command_results" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "command" "DispatchDocumentCommandType" NOT NULL,
  "status" "DispatchDocumentCommandStatus" NOT NULL,
  "result" JSONB,
  "failureCode" TEXT,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "dispatch_document_command_state_valid" CHECK (
    ("status" = 'STARTED' AND "completedAt" IS NULL AND "result" IS NULL AND "failureCode" IS NULL)
    OR ("status" = 'SUCCEEDED' AND "completedAt" IS NOT NULL AND "result" IS NOT NULL AND "failureCode" IS NULL)
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "dispatch_document_command_idempotency_key" ON "dispatch_document_command_results" ("scope", "scopeId", "idempotencyKey");
CREATE INDEX "dispatch_document_command_waybill_started_idx" ON "dispatch_document_command_results" ("waybillId", "startedAt");

CREATE TABLE "shipment_statement_cutovers" (
  "id" TEXT PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cutoverAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "activatedBy" TEXT,
  "manifestId" TEXT,
  "integrityHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipment_statement_cutover_state_valid" CHECK (
    (NOT "enabled" AND "cutoverAt" IS NULL AND "activatedAt" IS NULL AND "activatedBy" IS NULL AND "integrityHash" IS NULL)
    OR ("enabled" AND "cutoverAt" IS NOT NULL AND "activatedAt" IS NOT NULL AND "activatedBy" IS NOT NULL
        AND "manifestId" IS NOT NULL AND "integrityHash" ~ '^[0-9a-f]{64}$')
  )
);
INSERT INTO "shipment_statement_cutovers" ("id", "enabled") VALUES ('customer-shipment-statements', false);

CREATE TABLE "shipment_statement_migration_manifests" (
  "id" TEXT PRIMARY KEY,
  "migrationName" TEXT NOT NULL UNIQUE,
  "schemaVersion" INTEGER NOT NULL,
  "sourceSchemaHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "shipment_statement_manifest_schema_version_positive" CHECK ("schemaVersion" > 0),
  CONSTRAINT "shipment_statement_manifest_source_hash_sha256" CHECK ("sourceSchemaHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "shipment_statement_migration_runs" (
  "id" TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "status" "MigrationRunStatus" NOT NULL DEFAULT 'STARTED',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "reason" TEXT,
  CONSTRAINT "shipment_statement_migration_run_number_positive" CHECK ("runNumber" > 0),
  CONSTRAINT "shipment_statement_migration_run_state_valid" CHECK (
    ("status" = 'STARTED' AND "completedAt" IS NULL AND "reason" IS NULL)
    OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "reason" IS NULL)
    OR ("status" = 'FAILED' AND "completedAt" IS NOT NULL AND "reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "shipment_statement_migration_run_manifest_number_key" ON "shipment_statement_migration_runs" ("manifestId", "runNumber");
CREATE INDEX "shipment_statement_migration_run_status_started_idx" ON "shipment_statement_migration_runs" ("status", "startedAt");

CREATE TABLE "shipment_statement_migration_evidence" (
  "id" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "beforeRecordCount" BIGINT NOT NULL,
  "afterRecordCount" BIGINT NOT NULL,
  "beforeIdentityHash" TEXT NOT NULL,
  "afterIdentityHash" TEXT NOT NULL,
  "beforeQuantityTotal" DECIMAL(38,3),
  "afterQuantityTotal" DECIMAL(38,3),
  "beforeAmountTotal" DECIMAL(38,12),
  "afterAmountTotal" DECIMAL(38,12),
  "beforeEvidenceHash" TEXT NOT NULL,
  "afterEvidenceHash" TEXT NOT NULL,
  "outcome" "MigrationEvidenceOutcome" NOT NULL,
  "reason" TEXT,
  "detail" JSONB NOT NULL,
  CONSTRAINT "shipment_statement_evidence_counts_nonnegative" CHECK ("beforeRecordCount" >= 0 AND "afterRecordCount" >= 0),
  CONSTRAINT "shipment_statement_evidence_hashes_sha256" CHECK (
    "beforeIdentityHash" ~ '^[0-9a-f]{64}$' AND "afterIdentityHash" ~ '^[0-9a-f]{64}$'
    AND "beforeEvidenceHash" ~ '^[0-9a-f]{64}$' AND "afterEvidenceHash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "shipment_statement_evidence_outcome_valid" CHECK (
    ("outcome" = 'MATCHED' AND "reason" IS NULL
      AND "beforeRecordCount" = "afterRecordCount"
      AND "beforeIdentityHash" = "afterIdentityHash"
      AND "beforeQuantityTotal" IS NOT DISTINCT FROM "afterQuantityTotal"
      AND "beforeAmountTotal" IS NOT DISTINCT FROM "afterAmountTotal"
      AND "beforeEvidenceHash" = "afterEvidenceHash")
    OR ("outcome" IN ('QUARANTINED', 'FAILED') AND "reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "shipment_statement_migration_evidence_run_scope_key" ON "shipment_statement_migration_evidence" ("runId", "scope");
CREATE INDEX "shipment_statement_migration_evidence_outcome_idx" ON "shipment_statement_migration_evidence" ("outcome");

ALTER TABLE "contract_approved_pricing_versions" ADD CONSTRAINT "approved_pricing_version_contract_fk" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_approved_pricing_versions" ADD CONSTRAINT "approved_pricing_version_financial_record_fk" FOREIGN KEY ("sourceFinancialRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_approved_pricing_rows" ADD CONSTRAINT "approved_pricing_row_version_fk" FOREIGN KEY ("pricingVersionId") REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_approved_pricing_rows" ADD CONSTRAINT "approved_pricing_row_contract_item_fk" FOREIGN KEY ("contractItemId") REFERENCES "contract_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_approved_pricing_heads" ADD CONSTRAINT "approved_pricing_head_contract_fk" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_approved_pricing_heads" ADD CONSTRAINT "approved_pricing_head_version_fk" FOREIGN KEY ("currentVersionId") REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_pricing_readiness_results" ADD CONSTRAINT "pricing_readiness_contract_fk" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_pricing_readiness_results" ADD CONSTRAINT "pricing_readiness_version_fk" FOREIGN KEY ("pricingVersionId") REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_pricing_readiness_results" ADD CONSTRAINT "pricing_readiness_financial_record_fk" FOREIGN KEY ("sourceFinancialRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_pricing_readiness_reasons" ADD CONSTRAINT "pricing_readiness_reason_result_fk" FOREIGN KEY ("readinessResultId") REFERENCES "contract_pricing_readiness_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revision_pricing" ADD CONSTRAINT "allocation_pricing_revision_fk" FOREIGN KEY ("allocationRevisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revision_pricing" ADD CONSTRAINT "allocation_pricing_version_fk" FOREIGN KEY ("pricingVersionId") REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_priced_allocation_events" ADD CONSTRAINT "priced_allocation_revision_fk" FOREIGN KEY ("allocationRevisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_priced_allocation_events" ADD CONSTRAINT "priced_allocation_revision_line_fk" FOREIGN KEY ("allocationRevisionLineId") REFERENCES "logistics_allocation_revision_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_priced_allocation_events" ADD CONSTRAINT "priced_allocation_version_fk" FOREIGN KEY ("pricingVersionId") REFERENCES "contract_approved_pricing_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_priced_allocation_events" ADD CONSTRAINT "priced_allocation_pricing_row_fk" FOREIGN KEY ("pricingRowId") REFERENCES "contract_approved_pricing_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_statement_adjustments" ADD CONSTRAINT "statement_adjustment_waybill_fk" FOREIGN KEY ("waybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_statement_adjustments" ADD CONSTRAINT "statement_adjustment_correction_fk" FOREIGN KEY ("correctionId") REFERENCES "dispatch_corrections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_artifacts" ADD CONSTRAINT "dispatch_artifact_waybill_fk" FOREIGN KEY ("waybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_artifacts" ADD CONSTRAINT "dispatch_artifact_adjustment_fk" FOREIGN KEY ("statementAdjustmentId") REFERENCES "dispatch_statement_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_print_handoffs" ADD CONSTRAINT "print_handoff_waybill_fk" FOREIGN KEY ("waybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_print_handoff_items" ADD CONSTRAINT "print_handoff_item_handoff_fk" FOREIGN KEY ("handoffId") REFERENCES "dispatch_document_print_handoffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_print_handoff_items" ADD CONSTRAINT "print_handoff_item_artifact_fk" FOREIGN KEY ("artifactId") REFERENCES "dispatch_document_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_document_command_results" ADD CONSTRAINT "dispatch_document_command_waybill_fk" FOREIGN KEY ("waybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_statement_migration_runs" ADD CONSTRAINT "shipment_statement_migration_run_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "shipment_statement_migration_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_statement_migration_evidence" ADD CONSTRAINT "shipment_statement_migration_evidence_run_fk" FOREIGN KEY ("runId") REFERENCES "shipment_statement_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_shipment_statement_evidence_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'shipment statement evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approved_pricing_version_immutable BEFORE UPDATE OR DELETE ON "contract_approved_pricing_versions" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER approved_pricing_row_immutable BEFORE UPDATE OR DELETE ON "contract_approved_pricing_rows" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER pricing_readiness_result_immutable BEFORE UPDATE OR DELETE ON "contract_pricing_readiness_results" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER pricing_readiness_reason_immutable BEFORE UPDATE OR DELETE ON "contract_pricing_readiness_reasons" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER allocation_pricing_reference_immutable BEFORE UPDATE OR DELETE ON "logistics_allocation_revision_pricing" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER priced_allocation_event_immutable BEFORE UPDATE OR DELETE ON "dispatch_priced_allocation_events" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER statement_adjustment_immutable BEFORE UPDATE OR DELETE ON "dispatch_statement_adjustments" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER dispatch_document_artifact_immutable BEFORE UPDATE OR DELETE ON "dispatch_document_artifacts" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER print_handoff_item_immutable BEFORE UPDATE OR DELETE ON "dispatch_document_print_handoff_items" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER migration_manifest_immutable BEFORE UPDATE OR DELETE ON "shipment_statement_migration_manifests" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
CREATE TRIGGER migration_evidence_immutable BEFORE UPDATE OR DELETE ON "shipment_statement_migration_evidence" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();

CREATE FUNCTION validate_approved_pricing_graph() RETURNS trigger AS $$
DECLARE expected_contract TEXT;
DECLARE related_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'contract_approved_pricing_heads' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."currentVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'pricing head and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'contract_approved_pricing_rows' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    SELECT "contractId" INTO related_id FROM "contract_items" WHERE "id" = NEW."contractItemId";
    IF expected_contract IS DISTINCT FROM related_id THEN RAISE EXCEPTION 'pricing row and contract item contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'logistics_allocation_revision_pricing' THEN
    SELECT "contractId" INTO expected_contract FROM "contract_approved_pricing_versions" WHERE "id" = NEW."pricingVersionId";
    IF expected_contract IS DISTINCT FROM NEW."contractId" THEN RAISE EXCEPTION 'allocation pricing reference and version contracts differ'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_priced_allocation_events' THEN
    SELECT "pricingVersionId" INTO related_id FROM "contract_approved_pricing_rows" WHERE "id" = NEW."pricingRowId";
    IF related_id IS DISTINCT FROM NEW."pricingVersionId" THEN RAISE EXCEPTION 'priced event row and version differ'; END IF;
    SELECT "revisionId" INTO related_id FROM "logistics_allocation_revision_lines" WHERE "id" = NEW."allocationRevisionLineId";
    IF related_id IS DISTINCT FROM NEW."allocationRevisionId" THEN RAISE EXCEPTION 'priced event line and revision differ'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_statement_adjustments' THEN
    SELECT "waybillId" INTO related_id FROM "dispatch_corrections" WHERE "id" = NEW."correctionId";
    IF related_id IS DISTINCT FROM NEW."waybillId" THEN RAISE EXCEPTION 'statement adjustment and correction waybills differ'; END IF;
  ELSIF TG_TABLE_NAME = 'dispatch_document_artifacts' AND NEW."statementAdjustmentId" IS NOT NULL THEN
    SELECT "waybillId" INTO related_id FROM "dispatch_statement_adjustments" WHERE "id" = NEW."statementAdjustmentId";
    IF related_id IS DISTINCT FROM NEW."waybillId" THEN RAISE EXCEPTION 'adjustment artifact and adjustment waybills differ'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approved_pricing_head_graph BEFORE INSERT OR UPDATE ON "contract_approved_pricing_heads" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();
CREATE TRIGGER approved_pricing_row_graph BEFORE INSERT ON "contract_approved_pricing_rows" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();
CREATE TRIGGER allocation_pricing_reference_graph BEFORE INSERT ON "logistics_allocation_revision_pricing" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();
CREATE TRIGGER priced_allocation_event_graph BEFORE INSERT ON "dispatch_priced_allocation_events" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();
CREATE TRIGGER statement_adjustment_graph BEFORE INSERT ON "dispatch_statement_adjustments" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();
CREATE TRIGGER dispatch_document_artifact_graph BEFORE INSERT ON "dispatch_document_artifacts" FOR EACH ROW EXECUTE FUNCTION validate_approved_pricing_graph();

CREATE FUNCTION protect_shipment_statement_cutover() RETURNS trigger AS $$
BEGIN
  IF OLD."enabled" OR NEW."id" <> OLD."id" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'shipment statement cutover is immutable after activation';
  END IF;
  IF NOT NEW."enabled" THEN
    RAISE EXCEPTION 'shipment statement cutover update must activate the gate';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER shipment_statement_cutover_one_way BEFORE UPDATE ON "shipment_statement_cutovers" FOR EACH ROW EXECUTE FUNCTION protect_shipment_statement_cutover();
CREATE TRIGGER shipment_statement_cutover_no_delete BEFORE DELETE ON "shipment_statement_cutovers" FOR EACH ROW EXECUTE FUNCTION prevent_shipment_statement_evidence_change();
