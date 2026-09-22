CREATE TABLE accounting_operational_reconciliations (
  id TEXT PRIMARY KEY,
  "bookId" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "periodId" TEXT,
  "reconciliationCode" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$'),
  "sourceDebitRials" DECIMAL(20,0) NOT NULL,
  "sourceCreditRials" DECIMAL(20,0) NOT NULL,
  "ledgerDebitRials" DECIMAL(20,0) NOT NULL,
  "ledgerCreditRials" DECIMAL(20,0) NOT NULL,
  "unresolvedDifferences" JSONB NOT NULL,
  "controlPayload" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
  "reconciledAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT accounting_operational_reconciliations_scope_unique UNIQUE ("bookId", "fiscalYearId", "periodId", "reconciliationCode", "sourceSystem", "sourceSnapshotHash")
);

CREATE INDEX accounting_operational_reconciliations_scope_idx
  ON accounting_operational_reconciliations ("bookId", "fiscalYearId", "periodId", "reconciliationCode", "reconciledAt");

CREATE OR REPLACE FUNCTION prevent_accounting_operational_reconciliation_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'accounting operational reconciliations are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_operational_reconciliations_no_update
BEFORE UPDATE OR DELETE ON accounting_operational_reconciliations
FOR EACH ROW EXECUTE FUNCTION prevent_accounting_operational_reconciliation_mutation();
