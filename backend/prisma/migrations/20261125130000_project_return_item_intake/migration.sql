ALTER TABLE "project_return_version_items"
  ADD COLUMN "healthyCalculation" JSONB,
  ADD COLUMN "damagedCalculation" JSONB,
  ADD COLUMN "contractSources" JSONB,
  ADD COLUMN "inventoryIdentityId" TEXT,
  ADD CONSTRAINT "project_return_item_calculation_unit_check"
    CHECK ("unit" = 'meter' OR ("healthyCalculation" IS NULL AND "damagedCalculation" IS NULL)),
  ADD CONSTRAINT "project_return_item_healthy_stock_check"
    CHECK ("inventoryIdentityId" IS NULL OR "healthyQuantity" > 0),
  ADD CONSTRAINT "project_return_version_items_inventoryIdentityId_fkey"
    FOREIGN KEY ("inventoryIdentityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "project_return_version_items_inventoryIdentityId_key"
  ON "project_return_version_items"("inventoryIdentityId");
