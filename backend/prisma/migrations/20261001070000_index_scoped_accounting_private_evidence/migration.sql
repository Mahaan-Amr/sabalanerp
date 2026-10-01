-- Additive performance index matching createScope's ordinary-null ownership
-- exception exactly. Nested/null/false private evidence remains fail-closed.
-- PostgreSQL maintains membership atomically; no historical rows are rewritten.
-- Apply through the canonical verified release/checkpoint boundary.
CREATE INDEX accounting_financial_scoped_private_evidence_idx
ON accounting_financial_records (id)
WHERE metadata @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath
  OR CASE
    WHEN "sourceKind" = 'SALES_CONTRACT' AND "contractId" IS NOT NULL AND "sourceId" = "contractId"
      AND "sourceSnapshot" -> 'partnerCaseId' = 'null'::jsonb
    THEN ("sourceSnapshot" - 'partnerCaseId') @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath
    ELSE "sourceSnapshot" @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath
  END;
