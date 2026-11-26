ALTER TABLE "project_return_version_items"
  ADD COLUMN "effectiveWidthMeters" DECIMAL(65,30),
  ADD COLUMN "healthyAreaSquareMeters" DECIMAL(65,30),
  ADD COLUMN "damagedAreaSquareMeters" DECIMAL(65,30);
