ALTER TABLE "hr_collateral_items"
ADD COLUMN "collateralRequirementId" TEXT;

CREATE INDEX "hr_collateral_items_collateralRequirementId_idx"
ON "hr_collateral_items"("collateralRequirementId");

ALTER TABLE "hr_collateral_items"
ADD CONSTRAINT "hr_collateral_items_collateralRequirementId_fkey"
FOREIGN KEY ("collateralRequirementId") REFERENCES "hr_collateral_requirements"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
