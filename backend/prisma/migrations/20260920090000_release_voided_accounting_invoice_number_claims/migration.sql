DELETE FROM "accounting_invoice_number_claims" AS claim
USING "accounting_financial_records" AS record
WHERE claim."financialRecordId" = record."id"
  AND record."status" = 'VOIDED';
