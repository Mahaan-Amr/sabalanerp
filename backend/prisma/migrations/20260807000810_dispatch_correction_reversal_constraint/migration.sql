ALTER TABLE "shipment_quantity_evidence" DROP CONSTRAINT "shipment_quantity_negative_return_link_check";
ALTER TABLE "shipment_quantity_evidence"
  ADD CONSTRAINT "shipment_quantity_negative_return_link_check"
  CHECK (
    "kind" <> 'DISPATCH_CORRECTION_POSTED'
    OR "quantity" >= 0
    OR "returnEvidenceId" IS NOT NULL
    OR ("metadata"->>'reversalOfId') IS NOT NULL
  );
