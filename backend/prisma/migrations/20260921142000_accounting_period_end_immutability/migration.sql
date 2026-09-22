CREATE OR REPLACE FUNCTION accounting_period_end_reject_immutable_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Approved period-end evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_period_end_result_immutable"
BEFORE UPDATE OR DELETE ON "accounting_period_end_results"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_asset_policy_immutable"
BEFORE UPDATE OR DELETE ON "accounting_asset_class_policies"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_asset_event_immutable"
BEFORE UPDATE OR DELETE ON "accounting_asset_events"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_payroll_handoff_immutable"
BEFORE UPDATE OR DELETE ON "accounting_payroll_handoffs"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_payroll_settlement_attempt_immutable"
BEFORE UPDATE OR DELETE ON "accounting_payroll_settlement_attempts"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_statement_mapping_immutable"
BEFORE UPDATE OR DELETE ON "accounting_financial_statement_mappings"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_statement_mapping_row_immutable"
BEFORE UPDATE OR DELETE ON "accounting_financial_statement_mapping_rows"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_statutory_format_immutable"
BEFORE UPDATE OR DELETE ON "accounting_statutory_formats"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE TRIGGER "accounting_tax_compliance_attempt_immutable"
BEFORE UPDATE OR DELETE ON "accounting_tax_compliance_attempts"
FOR EACH ROW EXECUTE FUNCTION accounting_period_end_reject_immutable_change();

CREATE OR REPLACE FUNCTION accounting_guard_official_snapshot_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Official report snapshots cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."bookId" IS DISTINCT FROM OLD."bookId"
    OR NEW."snapshotIdentity" IS DISTINCT FROM OLD."snapshotIdentity"
    OR NEW."reportType" IS DISTINCT FROM OLD."reportType"
    OR NEW."parameters" IS DISTINCT FROM OLD."parameters"
    OR NEW."cutoffAt" IS DISTINCT FROM OLD."cutoffAt"
    OR NEW."mappingVersionId" IS DISTINCT FROM OLD."mappingVersionId"
    OR NEW."policyVersions" IS DISTINCT FROM OLD."policyVersions"
    OR NEW."sourceIdentities" IS DISTINCT FROM OLD."sourceIdentities"
    OR NEW."dataset" IS DISTINCT FROM OLD."dataset"
    OR NEW."datasetHash" IS DISTINCT FROM OLD."datasetHash"
    OR NEW."generatedBy" IS DISTINCT FROM OLD."generatedBy"
    OR NEW."generatedAt" IS DISTINCT FROM OLD."generatedAt"
    OR (OLD."pdfHash" IS NOT NULL AND NEW."pdfHash" IS DISTINCT FROM OLD."pdfHash")
    OR (OLD."excelHash" IS NOT NULL AND NEW."excelHash" IS DISTINCT FROM OLD."excelHash") THEN
    RAISE EXCEPTION 'Official report snapshot content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_official_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "accounting_official_report_snapshots"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_official_snapshot_change();

ALTER TABLE "accounting_asset_components"
ADD CONSTRAINT "accounting_asset_component_values_valid"
CHECK ("bookCostRials" >= 0 AND "taxCostRials" >= 0 AND "residualValueRials" >= 0 AND "usefulLifeMonths" > 0);

ALTER TABLE "accounting_payroll_obligations"
ADD CONSTRAINT "accounting_payroll_obligation_settlement_valid"
CHECK ("amountRials" > 0 AND "settledRials" >= 0 AND "settledRials" <= "amountRials");

ALTER TABLE "accounting_recognition_schedules"
ADD CONSTRAINT "accounting_recognition_schedule_amounts_valid"
CHECK ("totalRials" > 0 AND "recognizedRials" >= 0 AND "recognizedRials" <= "totalRials");
