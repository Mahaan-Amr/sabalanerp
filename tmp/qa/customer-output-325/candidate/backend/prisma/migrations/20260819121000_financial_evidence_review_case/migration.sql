ALTER TABLE "accounting_contract_flags"
  ADD COLUMN "trackingCode" TEXT,
  ADD COLUMN "sourceFinancialRecordId" TEXT,
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "evidence" JSONB;

CREATE UNIQUE INDEX "accounting_contract_flags_trackingCode_key"
  ON "accounting_contract_flags"("trackingCode");
CREATE INDEX "accounting_contract_flags_sourceFinancialRecordId_idx"
  ON "accounting_contract_flags"("sourceFinancialRecordId");
CREATE INDEX "accounting_contract_flags_assignedToUserId_status_idx"
  ON "accounting_contract_flags"("assignedToUserId", "status");
