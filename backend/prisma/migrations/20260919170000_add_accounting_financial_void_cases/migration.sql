CREATE TYPE "AccountingVoidCaseStatus" AS ENUM ('OPEN', 'CANCELLED', 'COMPLETED');
CREATE TYPE "AccountingVoidReasonKind" AS ENUM ('DUPLICATE_ISSUE', 'ENTRY_ERROR', 'SALE_CANCELLED', 'OTHER');

CREATE TABLE "accounting_financial_void_cases" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "retainedRecordId" TEXT,
    "status" "AccountingVoidCaseStatus" NOT NULL DEFAULT 'OPEN',
    "reasonKind" "AccountingVoidReasonKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_financial_void_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounting_financial_void_cases_contractId_createdAt_idx"
  ON "accounting_financial_void_cases"("contractId", "createdAt");
CREATE INDEX "accounting_financial_void_cases_sourceRecordId_status_idx"
  ON "accounting_financial_void_cases"("sourceRecordId", "status");
CREATE INDEX "accounting_financial_void_cases_status_startedAt_idx"
  ON "accounting_financial_void_cases"("status", "startedAt");
CREATE UNIQUE INDEX "accounting_financial_void_cases_one_open_per_record_idx"
  ON "accounting_financial_void_cases"("sourceRecordId") WHERE "status" = 'OPEN';
