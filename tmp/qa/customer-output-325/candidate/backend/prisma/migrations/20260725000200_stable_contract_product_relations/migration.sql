ALTER TABLE "contract_items" ADD COLUMN "productRowId" TEXT;
ALTER TABLE "delivery_products" ADD COLUMN "productRowId" TEXT;

CREATE UNIQUE INDEX "contract_items_contractId_productRowId_key"
  ON "contract_items"("contractId", "productRowId");
CREATE INDEX "delivery_products_productRowId_idx"
  ON "delivery_products"("productRowId");

ALTER TABLE "logistics_loading_lines" ADD COLUMN "productRowId" TEXT;
CREATE INDEX "logistics_loading_lines_productRowId_idx"
  ON "logistics_loading_lines"("productRowId");
