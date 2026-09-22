CREATE TABLE "inventory_valuation_evidence" (
  "id" TEXT NOT NULL,
  "shipmentQuantityEvidenceId" TEXT NOT NULL,
  "valuationVersion" INTEGER NOT NULL,
  "valuationMethod" TEXT NOT NULL,
  "inventoryDocumentId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unitCostRials" DECIMAL(20,0) NOT NULL,
  "totalCostRials" DECIMAL(20,0) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_valuation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_valuation_evidence_amounts_valid"
    CHECK ("valuationVersion" > 0 AND "quantity" > 0 AND "unitCostRials" >= 0 AND "totalCostRials" >= 0),
  CONSTRAINT "inventory_valuation_evidence_method_valid"
    CHECK ("valuationMethod" = 'SPECIFIC_IDENTIFICATION')
);

CREATE UNIQUE INDEX "inventory_valuation_evidence_shipment_version_key"
ON "inventory_valuation_evidence"("shipmentQuantityEvidenceId", "valuationVersion");

CREATE UNIQUE INDEX "inventory_valuation_evidence_document_row_version_key"
ON "inventory_valuation_evidence"("inventoryDocumentId", "productRowId", "valuationVersion");

CREATE INDEX "inventory_valuation_evidence_contract_row_effective_idx"
ON "inventory_valuation_evidence"("contractId", "productRowId", "effectiveAt");

ALTER TABLE "inventory_valuation_evidence"
ADD CONSTRAINT "inventory_valuation_evidence_shipment_fkey"
FOREIGN KEY ("shipmentQuantityEvidenceId") REFERENCES "shipment_quantity_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "inventory_valuation_evidence_immutable"
BEFORE UPDATE OR DELETE ON "inventory_valuation_evidence"
FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
