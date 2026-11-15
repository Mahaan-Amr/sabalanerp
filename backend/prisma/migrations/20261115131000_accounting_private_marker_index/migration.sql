-- The private-evidence predicate is presence-based, including nested null/false
-- markers. Index the exact predicate so Accounting reads can enumerate only
-- marked sources before intersecting with their selected financial IDs.
CREATE INDEX accounting_financial_records_partner_marker_id_idx
ON accounting_financial_records (id)
WHERE (metadata @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath
  OR CASE WHEN "sourceKind" = 'SALES_CONTRACT' AND "contractId" IS NOT NULL
      AND "sourceId" = "contractId" AND "sourceSnapshot" -> 'partnerCaseId' = 'null'::jsonb
    THEN ("sourceSnapshot" - 'partnerCaseId') @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath
    ELSE "sourceSnapshot" @? '$.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) || exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) || @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")'::jsonpath END);
