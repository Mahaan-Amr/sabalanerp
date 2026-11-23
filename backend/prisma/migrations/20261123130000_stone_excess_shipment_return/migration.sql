ALTER TYPE "ShipmentQuantityEvidenceKind" ADD VALUE 'EXCESS_RETURN_FINALIZED';

ALTER TABLE "shipment_quantity_evidence"
  ADD CONSTRAINT "shipment_quantity_excess_return_links_check" CHECK (
    "kind"::text <> 'EXCESS_RETURN_FINALIZED'
    OR (
      "sourceKind" = 'SALES_CONTRACT'
      AND "sourceType" = 'STONE_EXCESS_RETURN_ALLOCATION'
      AND "sourceVersion" = 1
      AND length(trim("sourceId")) > 0
      AND "dispatchEvidenceId" IS NOT NULL
      AND "guardReturnMovementId" IS NULL
      AND "returnEvidenceId" IS NULL
      AND "quantity" > 0
      AND "effectiveAt" <= "recordedAt"
      AND coalesce(length(trim("metadata"->>'returnCaseId')), 0) > 0
      AND coalesce(length(trim("metadata"->>'actorId')), 0) > 0
    )
  );

ALTER TABLE "shipment_quantity_projections"
  ADD COLUMN "approvedGrossContracted" DECIMAL(65,30),
  ADD COLUMN "excessRetired" DECIMAL(65,30),
  ADD CONSTRAINT "shipment_quantity_projection_excess_retirement_check" CHECK (
    ("approvedGrossContracted" IS NULL AND "excessRetired" IS NULL)
    OR (
      "approvedGrossContracted" IS NOT NULL AND "excessRetired" IS NOT NULL
      AND "contracted" IS NOT NULL AND "excessRetired" > 0
      AND "contracted" = "approvedGrossContracted" - "excessRetired"
    )
  );
