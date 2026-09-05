ALTER TABLE "partner_customer_output_snapshots"
  ADD CONSTRAINT "partner_customer_output_snapshots_id_caseId_caseRevision_key"
  UNIQUE ("id", "caseId", "caseRevision");

ALTER TABLE "partner_customer_artifacts"
  DROP CONSTRAINT "partner_customer_artifacts_snapshotId_fkey",
  ADD CONSTRAINT "partner_customer_artifact_snapshot_owner"
    FOREIGN KEY ("snapshotId", "caseId", "caseRevision")
    REFERENCES "partner_customer_output_snapshots"("id", "caseId", "caseRevision")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "partner_customer_artifacts_mode_check"
    CHECK ("mode" IN ('PREVIEW', 'FINAL')),
  ADD CONSTRAINT "partner_customer_artifacts_output_hash_check"
    CHECK ("outputHash" ~ '^sha256-v1:[a-f0-9]{64}$'),
  ADD CONSTRAINT "partner_customer_artifacts_byte_hash_check"
    CHECK ("byteHash" ~ '^sha256-v1:[a-f0-9]{64}$'),
  ADD CONSTRAINT "partner_customer_artifacts_content_check"
    CHECK (octet_length("content") > 0);

ALTER TABLE "partner_fulfillment_lineages"
  DROP CONSTRAINT "partner_fulfillment_lineages_caseId_productRowId_key",
  ADD CONSTRAINT "partner_fulfillment_lineages_caseId_caseRevision_productRowId_key"
    UNIQUE ("caseId", "caseRevision", "productRowId"),
  ADD CONSTRAINT "partner_fulfillment_revision"
    FOREIGN KEY ("caseId", "caseRevision")
    REFERENCES "partner_case_revisions"("caseId", "revision")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "partner_fulfillment_internal_record"
    FOREIGN KEY ("internalRecordId")
    REFERENCES "sabalan_to_partner_sale_records"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "partner_fulfillment_row_binding"
    FOREIGN KEY ("caseId", "caseRevision", "productRowId")
    REFERENCES "partner_case_row_bindings"("caseId", "revision", "productRowId")
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "partner_fulfillment_integrity_hash_check"
    CHECK ("integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$'),
  ADD CONSTRAINT "partner_fulfillment_quantity_check"
    CHECK ("quantity" > 0),
  ADD CONSTRAINT "partner_fulfillment_delivery_ids_check"
    CHECK (jsonb_typeof("deliveryIds") = 'array'),
  ADD CONSTRAINT "partner_fulfillment_recipient_check"
    CHECK (jsonb_typeof("recipient") = 'object');

ALTER TABLE "partner_report_exports"
  ADD CONSTRAINT "partner_report_exports_content_hash_check"
    CHECK ("contentHash" ~ '^sha256-v1:[a-f0-9]{64}$'),
  ADD CONSTRAINT "partner_report_exports_expiry_check"
    CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "partner_report_exports_roots_check"
    CHECK (jsonb_typeof("roots") = 'array'),
  ADD CONSTRAINT "partner_report_exports_query_check"
    CHECK (jsonb_typeof("query") = 'object'),
  ADD CONSTRAINT "partner_report_exports_report_check"
    CHECK (jsonb_typeof("report") = 'object');

CREATE FUNCTION reject_partner_immutable_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Partner evidence table % is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER partner_customer_artifacts_immutable
BEFORE UPDATE OR DELETE ON "partner_customer_artifacts"
FOR EACH ROW EXECUTE FUNCTION reject_partner_immutable_evidence_change();

CREATE TRIGGER partner_fulfillment_lineages_immutable
BEFORE UPDATE OR DELETE ON "partner_fulfillment_lineages"
FOR EACH ROW EXECUTE FUNCTION reject_partner_immutable_evidence_change();

CREATE TRIGGER partner_report_exports_immutable
BEFORE UPDATE OR DELETE ON "partner_report_exports"
FOR EACH ROW EXECUTE FUNCTION reject_partner_immutable_evidence_change();
