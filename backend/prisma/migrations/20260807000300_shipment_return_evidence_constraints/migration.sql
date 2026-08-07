ALTER TABLE "shipment_quantity_evidence"
  ADD COLUMN "dispatchEvidenceId" TEXT;

CREATE INDEX "shipment_quantity_evidence_dispatchEvidenceId_idx"
  ON "shipment_quantity_evidence"("dispatchEvidenceId");
CREATE UNIQUE INDEX "shipment_quantity_evidence_guardReturnMovementId_contractItemId_dispatchEvidenceId_key"
  ON "shipment_quantity_evidence"("guardReturnMovementId", "contractItemId", "dispatchEvidenceId");

ALTER TABLE "shipment_quantity_evidence"
  ADD CONSTRAINT "shipment_quantity_evidence_dispatchEvidenceId_fkey"
  FOREIGN KEY ("dispatchEvidenceId") REFERENCES "shipment_quantity_evidence"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipment_quantity_evidence"
  ADD CONSTRAINT "shipment_quantity_guard_return_links_check"
  CHECK (
    "kind" <> 'GUARD_RETURN_VERIFIED'
    OR ("guardReturnMovementId" IS NOT NULL AND "dispatchEvidenceId" IS NOT NULL)
  );

ALTER TABLE "shipment_quantity_evidence"
  ADD CONSTRAINT "shipment_quantity_negative_return_link_check"
  CHECK (
    "kind" <> 'DISPATCH_CORRECTION_POSTED'
    OR "quantity" >= 0
    OR "returnEvidenceId" IS NOT NULL
  );
