CREATE TABLE "accounting_inventory_cost_evidence" (
  "id" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "contractId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "costRials" DECIMAL(20,0) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_inventory_cost_evidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_inventory_cost_evidence_source_key"
ON "accounting_inventory_cost_evidence"("sourceType", "sourceId", "sourceVersion");
CREATE INDEX "accounting_inventory_cost_evidence_contract_row_effective_idx"
ON "accounting_inventory_cost_evidence"("contractId", "productRowId", "effectiveAt");
ALTER TABLE "accounting_inventory_cost_evidence" ADD CONSTRAINT "accounting_inventory_cost_nonnegative"
CHECK ("quantity" > 0 AND "costRials" >= 0);
CREATE TRIGGER "accounting_inventory_cost_evidence_immutable"
BEFORE UPDATE OR DELETE ON "accounting_inventory_cost_evidence"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
