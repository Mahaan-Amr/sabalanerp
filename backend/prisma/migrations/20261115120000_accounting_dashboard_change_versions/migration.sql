-- Transactional, bounded change tokens for the Accounting dashboard. A
-- revision advances with the write, including DELETE and imported updates
-- that retain updatedAt. No financial evidence is copied into this table.
CREATE TABLE accounting_dashboard_change_versions (
  scope text NOT NULL,
  bucket smallint NOT NULL,
  PRIMARY KEY (scope, bucket),
  revision bigint NOT NULL DEFAULT 0
);

CREATE FUNCTION bump_accounting_dashboard_version(target_scope text, row_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  target_bucket smallint := (hashtext(row_id)::bigint & 31)::smallint;
BEGIN
  INSERT INTO accounting_dashboard_change_versions (scope, bucket, revision)
    VALUES (target_scope, target_bucket, 1)
    ON CONFLICT (scope, bucket) DO UPDATE
      SET revision = accounting_dashboard_change_versions.revision + 1;
END;
$$;

-- Resolve only the owning internal record. Unknown/legacy links fail
-- conservatively into the ordinary token so a change cannot be missed.
CREATE FUNCTION accounting_dashboard_row_scope(table_name text, row_value jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  source_kind text;
  internal_id text;
  invoice_id text;
BEGIN
  IF table_name = 'accounting_financial_records' THEN
    IF row_value ->> 'sourceKind' = 'PARTNER_INTERNAL_RECORD' THEN
      internal_id := row_value ->> 'sourceId';
    END IF;
  ELSIF table_name = 'partner_sale_cases' THEN
    internal_id := row_value ->> 'internalRecordId';
  ELSIF table_name = 'sales_contracts' THEN
    IF row_value ->> 'partnerCaseId' IS NOT NULL THEN
      SELECT "internalRecordId" INTO internal_id FROM partner_sale_cases
        WHERE id = row_value ->> 'partnerCaseId';
    END IF;
  ELSIF table_name = 'contract_items' OR table_name = 'payments' THEN
    SELECT accounting_dashboard_row_scope('sales_contracts', to_jsonb(sale))
      INTO source_kind FROM sales_contracts AS sale
      WHERE sale.id = row_value ->> 'contractId';
    RETURN COALESCE(source_kind, 'ordinary');
  ELSIF table_name = 'payment_installments' THEN
    SELECT accounting_dashboard_row_scope('payments', to_jsonb(payment))
      INTO source_kind FROM payments AS payment
      WHERE payment.id = row_value ->> 'paymentId';
    RETURN COALESCE(source_kind, 'ordinary');
  ELSIF table_name = 'accounting_receivables' OR table_name = 'accounting_tax_records' THEN
    invoice_id := row_value ->> 'invoiceRecordId';
  ELSIF table_name = 'accounting_payment_statuses' THEN
    SELECT "invoiceRecordId" INTO invoice_id FROM accounting_receivables
      WHERE id = row_value ->> 'receivableId';
  ELSIF table_name = 'accounting_invoice_candidate_items' THEN
    invoice_id := row_value ->> 'invoiceId';
  END IF;
  IF invoice_id IS NOT NULL THEN
    SELECT "sourceKind"::text, "sourceId" INTO source_kind, internal_id
      FROM accounting_financial_records WHERE id = invoice_id;
    IF source_kind <> 'PARTNER_INTERNAL_RECORD' THEN internal_id := NULL; END IF;
  END IF;
  RETURN CASE WHEN internal_id IS NULL THEN 'ordinary'
    ELSE 'partner:' || internal_id END;
END;
$$;

CREATE FUNCTION mark_accounting_dashboard_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_scope text;
  after_scope text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    before_scope := accounting_dashboard_row_scope(TG_TABLE_NAME, to_jsonb(OLD));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    after_scope := accounting_dashboard_row_scope(TG_TABLE_NAME, to_jsonb(NEW));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
  IF before_scope IS NOT NULL THEN
    PERFORM bump_accounting_dashboard_version(before_scope || ':workspace', OLD.id);
    IF TG_TABLE_NAME IN ('accounting_financial_records', 'accounting_receivables',
        'accounting_payment_statuses', 'accounting_audit_logs') THEN
      PERFORM bump_accounting_dashboard_version(before_scope || ':trend', OLD.id);
    END IF;
  END IF;
  IF after_scope IS NOT NULL AND after_scope IS DISTINCT FROM before_scope THEN
    PERFORM bump_accounting_dashboard_version(after_scope || ':workspace', NEW.id);
    IF TG_TABLE_NAME IN ('accounting_financial_records', 'accounting_receivables',
        'accounting_payment_statuses', 'accounting_audit_logs') THEN
      PERFORM bump_accounting_dashboard_version(after_scope || ':trend', NEW.id);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER accounting_dashboard_sales_contract_change
  AFTER INSERT OR UPDATE OR DELETE ON sales_contracts
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_financial_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_financial_records
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_receivable_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_receivables
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_payment_statuses
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_tax_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_tax_records
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_correction_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_correction_requests
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_audit_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_audit_logs
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_invoice_item_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_invoice_candidate_items
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_contract_flag_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_contract_flags
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_case_change
  AFTER INSERT OR UPDATE OR DELETE ON partner_sale_cases
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_contract_item_change
  AFTER INSERT OR UPDATE OR DELETE ON contract_items
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_legacy_payment_change
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_installment_change
  AFTER INSERT OR UPDATE OR DELETE ON payment_installments
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
