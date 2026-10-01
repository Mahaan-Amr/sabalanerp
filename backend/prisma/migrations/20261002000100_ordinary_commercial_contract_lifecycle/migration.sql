ALTER TABLE "sales_contracts"
  ADD COLUMN "commercialFlowVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "commercialRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "salesApprovalRevision" INTEGER,
  ADD COLUMN "customerAcceptanceRevision" INTEGER,
  ADD COLUMN "customerAcceptanceMethod" TEXT,
  ADD COLUMN "commercialStartedAt" TIMESTAMP(3),
  ADD COLUMN "commercialExpiresAt" TIMESTAMP(3),
  ADD COLUMN "commercialExpiryDays" INTEGER,
  ADD COLUMN "firstFinancialRecordAt" TIMESTAMP(3);
ALTER TABLE "contract_public_confirmations" ADD COLUMN "commercialRevision" INTEGER;
CREATE TABLE "sales_commercial_settings" (
  "id" TEXT NOT NULL DEFAULT 'ordinary-contracts', "expiryDays" INTEGER NOT NULL DEFAULT 10,
  "updatedBy" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_commercial_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_commercial_settings_expiryDays_check" CHECK ("expiryDays" BETWEEN 1 AND 365)
);
