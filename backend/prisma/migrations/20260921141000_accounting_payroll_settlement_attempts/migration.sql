CREATE TABLE "accounting_payroll_settlement_attempts" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "attemptIdentity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountRials" DECIMAL(20,0) NOT NULL,
    "bankResultHash" TEXT,
    "failureReason" TEXT,
    "attemptedBy" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_payroll_settlement_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_payroll_settlement_attempts_attemptIdentity_key"
ON "accounting_payroll_settlement_attempts"("attemptIdentity");

CREATE INDEX "accounting_payroll_settlement_attempts_obligationId_attemptedAt_idx"
ON "accounting_payroll_settlement_attempts"("obligationId", "attemptedAt");

ALTER TABLE "accounting_payroll_settlement_attempts"
ADD CONSTRAINT "accounting_payroll_settlement_attempts_obligationId_fkey"
FOREIGN KEY ("obligationId") REFERENCES "accounting_payroll_obligations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
