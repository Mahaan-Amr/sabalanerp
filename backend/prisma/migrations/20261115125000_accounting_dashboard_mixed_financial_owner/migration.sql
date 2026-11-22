-- A financial row's sourceKind alone cannot override a Partner contract or
-- retained private evidence. Keep the row value available for DELETE triggers.
CREATE FUNCTION accounting_dashboard_financial_value_owner(row_value jsonb)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  owner text := 'ordinary';
  contract_owner text;
  case_id text;
  case_owner text;
  snapshot jsonb := COALESCE(row_value -> 'sourceSnapshot', 'null'::jsonb);
  marker_path jsonpath := '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath;
BEGIN
  IF row_value ->> 'sourceKind' = 'PARTNER_INTERNAL_RECORD' THEN
    owner := CASE WHEN row_value ->> 'sourceId' IS NULL THEN NULL
      ELSE 'partner:' || (row_value ->> 'sourceId') END;
  END IF;
  IF row_value ->> 'contractId' IS NOT NULL THEN
    contract_owner := accounting_dashboard_contract_owner(row_value ->> 'contractId');
    IF contract_owner IS NULL THEN RETURN NULL; END IF;
    IF contract_owner LIKE 'partner:%' THEN
      IF owner LIKE 'partner:%' AND owner <> contract_owner THEN RETURN NULL; END IF;
      owner := contract_owner;
    END IF;
  END IF;
  -- Ordinary Contract snapshots can retain the nullable ownership column at
  -- their root. The read scope recognizes that one schema-shape exception.
  IF jsonb_typeof(snapshot) = 'object' AND snapshot ? 'partnerCaseId'
      AND snapshot -> 'partnerCaseId' = 'null'::jsonb THEN
    snapshot := snapshot - 'partnerCaseId';
  END IF;
  IF COALESCE(row_value -> 'metadata', 'null'::jsonb) @? marker_path OR snapshot @? marker_path THEN
    case_id := COALESCE(row_value #>> '{metadata,partnerCaseId}',
      snapshot #>> '{partnerCaseId}');
    IF case_id IS NOT NULL THEN
      SELECT "internalRecordId" INTO case_owner FROM partner_sale_cases WHERE id = case_id;
      IF case_owner IS NOT NULL THEN
        contract_owner := 'partner:' || case_owner;
        IF owner LIKE 'partner:%' AND owner <> contract_owner THEN RETURN NULL; END IF;
        owner := contract_owner;
      END IF;
    END IF;
    IF owner = 'ordinary' THEN RETURN NULL; END IF;
  END IF;
  RETURN owner;
END;
$$;

CREATE OR REPLACE FUNCTION accounting_dashboard_financial_owner(record_id text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  owner text;
BEGIN
  IF record_id IS NULL THEN RETURN 'ordinary'; END IF;
  SELECT accounting_dashboard_financial_value_owner(to_jsonb(f))
    INTO owner FROM accounting_financial_records AS f WHERE f.id = record_id;
  RETURN CASE WHEN FOUND THEN owner ELSE 'ordinary' END;
END;
$$;

ALTER FUNCTION accounting_dashboard_row_scope(text, jsonb)
  RENAME TO accounting_dashboard_row_scope_base;

CREATE FUNCTION accounting_dashboard_row_scope(table_name text, row_value jsonb)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF table_name = 'accounting_financial_records' THEN
    RETURN accounting_dashboard_financial_value_owner(row_value);
  END IF;
  RETURN accounting_dashboard_row_scope_base(table_name, row_value);
END;
$$;
