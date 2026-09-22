CREATE TYPE "AccountingSupplyChainCommandAuditResult" AS ENUM ('SUCCEEDED', 'DENIED');

ALTER TABLE "accounting_party_role_assignments"
  ADD COLUMN "evidenceType" TEXT,
  ADD COLUMN "evidenceId" TEXT,
  ADD COLUMN "evidenceVersion" INTEGER,
  ADD COLUMN "evidenceHash" TEXT,
  ADD COLUMN "evidencePayload" JSONB;

ALTER TABLE "accounting_supplier_treasury_transactions"
  ADD COLUMN "financialAccountId" TEXT;

ALTER TABLE "accounting_inventory_migration_items"
  ADD COLUMN "rejectionReason" TEXT;

CREATE TABLE "accounting_supply_chain_command_audits" (
  "id" TEXT NOT NULL,
  "commandName" TEXT NOT NULL,
  "result" "AccountingSupplyChainCommandAuditResult" NOT NULL,
  "actorId" TEXT NOT NULL,
  "effectiveProfile" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_supply_chain_command_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounting_supply_chain_command_audits_actorId_createdAt_idx"
  ON "accounting_supply_chain_command_audits"("actorId", "createdAt");
CREATE INDEX "accounting_supply_chain_command_audits_commandName_result_createdAt_idx"
  ON "accounting_supply_chain_command_audits"("commandName", "result", "createdAt");
CREATE INDEX "accounting_supplier_treasury_transactions_financialAccountId_idx"
  ON "accounting_supplier_treasury_transactions"("financialAccountId");

ALTER TABLE "accounting_supplier_treasury_transactions"
  ADD CONSTRAINT "accounting_supplier_treasury_transactions_financialAccountId_fkey"
  FOREIGN KEY ("financialAccountId") REFERENCES "accounting_financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "accounting_supply_chain_command_audit_immutability"
BEFORE UPDATE OR DELETE ON "accounting_supply_chain_command_audits"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

ALTER TABLE "accounting_inventory_migration_items"
  ADD CONSTRAINT "accounting_inventory_migration_rejection_reason_valid"
  CHECK (("disposition" <> 'REJECTED' AND "rejectionReason" IS NULL)
      OR ("disposition" = 'REJECTED' AND length(btrim("rejectionReason")) > 0));
