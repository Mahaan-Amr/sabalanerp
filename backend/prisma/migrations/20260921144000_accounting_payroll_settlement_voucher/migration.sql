ALTER TABLE accounting_payroll_settlement_attempts
  ADD COLUMN "settlementVoucherId" TEXT;

ALTER TABLE accounting_payroll_settlement_attempts
  ADD CONSTRAINT accounting_payroll_settlement_success_evidence_check
  CHECK (
    status <> 'SUCCEEDED'
    OR ("bankResultHash" ~ '^[a-f0-9]{64}$' AND "settlementVoucherId" IS NOT NULL)
  );
