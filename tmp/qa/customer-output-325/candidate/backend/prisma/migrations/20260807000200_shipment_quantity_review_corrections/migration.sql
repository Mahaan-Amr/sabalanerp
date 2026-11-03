ALTER TYPE "ShipmentQuantityEvidenceKind" ADD VALUE IF NOT EXISTS 'GUARD_RETURN_VERIFIED';

ALTER TABLE "shipment_quantity_evidence"
  ADD COLUMN IF NOT EXISTS "guardReturnMovementId" TEXT,
  ADD COLUMN IF NOT EXISTS "returnEvidenceId" TEXT;

CREATE INDEX IF NOT EXISTS "shipment_quantity_evidence_guardReturnMovementId_idx"
  ON "shipment_quantity_evidence"("guardReturnMovementId");
CREATE INDEX IF NOT EXISTS "shipment_quantity_evidence_returnEvidenceId_idx"
  ON "shipment_quantity_evidence"("returnEvidenceId");

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipment_quantity_evidence_guardReturnMovementId_fkey'
  ) THEN
    ALTER TABLE "shipment_quantity_evidence"
      ADD CONSTRAINT "shipment_quantity_evidence_guardReturnMovementId_fkey"
      FOREIGN KEY ("guardReturnMovementId") REFERENCES "security_vehicle_movements"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipment_quantity_evidence_returnEvidenceId_fkey'
  ) THEN
    ALTER TABLE "shipment_quantity_evidence"
      ADD CONSTRAINT "shipment_quantity_evidence_returnEvidenceId_fkey"
      FOREIGN KEY ("returnEvidenceId") REFERENCES "shipment_quantity_evidence"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
