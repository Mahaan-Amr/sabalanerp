-- Resolve every Accounting reference that can identify a Partner owner.
-- Unknown retained Partner markers yield no dashboard token: the shared read
-- scope hides them, and an ordinary token would disclose private activity.
CREATE FUNCTION accounting_dashboard_contract_owner(contract_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  owner_id text;
  kind text;
  case_id text;
BEGIN
  IF contract_id IS NULL THEN RETURN 'ordinary'; END IF;
  SELECT "partnerCaseId", "partnerKind" INTO case_id, kind FROM sales_contracts WHERE id = contract_id;
  IF NOT FOUND THEN RETURN 'ordinary'; END IF;
  IF case_id IS NULL AND kind IS NULL THEN RETURN 'ordinary'; END IF;
  SELECT "internalRecordId" INTO owner_id FROM partner_sale_cases WHERE id = case_id;
  RETURN CASE WHEN owner_id IS NULL THEN NULL ELSE 'partner:' || owner_id END;
END;
$$;

CREATE FUNCTION accounting_dashboard_financial_owner(record_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  kind text;
  source_id text;
BEGIN
  IF record_id IS NULL THEN RETURN 'ordinary'; END IF;
  SELECT "sourceKind"::text, "sourceId" INTO kind, source_id
    FROM accounting_financial_records WHERE id = record_id;
  IF NOT FOUND THEN RETURN 'ordinary'; END IF;
  RETURN CASE WHEN kind = 'PARTNER_INTERNAL_RECORD'
    THEN CASE WHEN source_id IS NULL THEN NULL ELSE 'partner:' || source_id END
    ELSE 'ordinary' END;
END;
$$;

CREATE OR REPLACE FUNCTION accounting_dashboard_row_scope(table_name text, row_value jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  owner text := 'ordinary';
  candidate text;
  invoice_id text;
  receivable_id text;
  contract_id text;
  record_id text;
  entity_kind text;
  entity_id text;
  marker_case_id text;
  marker_owner text;
  owner_refs text[] := ARRAY[]::text[];
BEGIN
  IF table_name = 'accounting_financial_records' THEN
    RETURN CASE WHEN row_value ->> 'sourceKind' = 'PARTNER_INTERNAL_RECORD'
      THEN CASE WHEN row_value ->> 'sourceId' IS NULL THEN NULL
        ELSE 'partner:' || (row_value ->> 'sourceId') END
      ELSE 'ordinary' END;
  ELSIF table_name = 'partner_sale_cases' THEN
    RETURN CASE WHEN row_value ->> 'internalRecordId' IS NULL THEN NULL
      ELSE 'partner:' || (row_value ->> 'internalRecordId') END;
  ELSIF table_name = 'sales_contracts' THEN
    IF row_value ->> 'partnerCaseId' IS NULL AND row_value ->> 'partnerKind' IS NULL THEN RETURN 'ordinary'; END IF;
    SELECT "internalRecordId" INTO marker_owner FROM partner_sale_cases
      WHERE id = row_value ->> 'partnerCaseId';
    RETURN CASE WHEN marker_owner IS NULL THEN NULL ELSE 'partner:' || marker_owner END;
  ELSIF table_name IN ('contract_items', 'payments') THEN
    RETURN accounting_dashboard_contract_owner(row_value ->> 'contractId');
  ELSIF table_name = 'payment_installments' THEN
    SELECT "contractId" INTO contract_id FROM payments WHERE id = row_value ->> 'paymentId';
    RETURN accounting_dashboard_contract_owner(contract_id);
  ELSIF table_name = 'accounting_invoice_candidate_items' THEN
    RETURN accounting_dashboard_financial_owner(row_value ->> 'invoiceId');
  ELSIF table_name = 'accounting_receivables' OR table_name = 'accounting_tax_records' THEN
    invoice_id := row_value ->> 'invoiceRecordId';
    contract_id := row_value ->> 'contractId';
  ELSIF table_name = 'accounting_payment_statuses' THEN
    receivable_id := row_value ->> 'receivableId';
    contract_id := row_value ->> 'contractId';
  ELSIF table_name = 'accounting_correction_requests' THEN
    record_id := row_value ->> 'recordId';
    contract_id := row_value ->> 'contractId';
  ELSIF table_name = 'accounting_contract_flags' THEN
    record_id := row_value ->> 'sourceFinancialRecordId';
    contract_id := row_value ->> 'contractId';
  ELSIF table_name = 'accounting_audit_logs' THEN
    record_id := row_value ->> 'recordId';
    contract_id := row_value ->> 'contractId';
    entity_kind := row_value ->> 'entityType';
    entity_id := row_value ->> 'entityId';
  ELSE
    RETURN 'ordinary';
  END IF;

  IF invoice_id IS NOT NULL THEN
    owner_refs := array_append(owner_refs, accounting_dashboard_financial_owner(invoice_id));
  END IF;
  IF receivable_id IS NOT NULL THEN
    SELECT accounting_dashboard_row_scope('accounting_receivables', to_jsonb(r))
      INTO candidate FROM accounting_receivables AS r WHERE r.id = receivable_id;
    IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    owner_refs := array_append(owner_refs, candidate);
  END IF;
  IF record_id IS NOT NULL THEN
    owner_refs := array_append(owner_refs, accounting_dashboard_financial_owner(record_id));
  END IF;
  IF contract_id IS NOT NULL THEN
    owner_refs := array_append(owner_refs, accounting_dashboard_contract_owner(contract_id));
  END IF;
  IF entity_id IS NOT NULL THEN
    candidate := 'ordinary';
    IF entity_kind = 'AccountingFinancialRecord' THEN
      candidate := accounting_dashboard_financial_owner(entity_id);
    ELSIF entity_kind = 'AccountingReceivable' THEN
      SELECT accounting_dashboard_row_scope('accounting_receivables', to_jsonb(r))
        INTO candidate FROM accounting_receivables AS r WHERE r.id = entity_id;
      IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    ELSIF entity_kind = 'AccountingPaymentStatus' THEN
      SELECT accounting_dashboard_row_scope('accounting_payment_statuses', to_jsonb(p))
        INTO candidate FROM accounting_payment_statuses AS p WHERE p.id = entity_id;
      IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    ELSIF entity_kind = 'AccountingTaxRecord' THEN
      SELECT accounting_dashboard_row_scope('accounting_tax_records', to_jsonb(t))
        INTO candidate FROM accounting_tax_records AS t WHERE t.id = entity_id;
      IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    ELSIF entity_kind = 'AccountingCorrectionRequest' THEN
      SELECT accounting_dashboard_row_scope('accounting_correction_requests', to_jsonb(c))
        INTO candidate FROM accounting_correction_requests AS c WHERE c.id = entity_id;
      IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    ELSIF entity_kind = 'AccountingContractFlag' THEN
      SELECT accounting_dashboard_row_scope('accounting_contract_flags', to_jsonb(f))
        INTO candidate FROM accounting_contract_flags AS f WHERE f.id = entity_id;
      IF NOT FOUND THEN candidate := 'ordinary'; END IF;
    END IF;
    owner_refs := array_append(owner_refs, candidate);
  END IF;

  FOREACH candidate IN ARRAY owner_refs LOOP
    IF candidate IS NULL THEN RETURN NULL; END IF;
    IF candidate LIKE 'partner:%' THEN
      IF owner LIKE 'partner:%' AND owner <> candidate THEN RETURN NULL; END IF;
      owner := candidate;
    END IF;
  END LOOP;

  -- Presence-based markers match the private read boundary, even when the
  -- referenced row was deleted or an imported snapshot lacks a valid owner.
  IF row_value @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath THEN
    marker_case_id := COALESCE(row_value #>> '{metadata,partnerCaseId}',
      row_value #>> '{evidence,partnerCaseId}',
      row_value #>> '{beforeState,partnerCaseId}',
      row_value #>> '{afterState,partnerCaseId}');
    IF marker_case_id IS NOT NULL THEN
      SELECT "internalRecordId" INTO marker_owner FROM partner_sale_cases WHERE id = marker_case_id;
      IF marker_owner IS NOT NULL THEN
        candidate := 'partner:' || marker_owner;
        IF owner LIKE 'partner:%' AND owner <> candidate THEN RETURN NULL; END IF;
        owner := candidate;
      END IF;
    END IF;
    IF owner = 'ordinary' THEN RETURN NULL; END IF;
  END IF;
  RETURN owner;
END;
$$;
