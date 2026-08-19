-- Preserve historical values while allowing canonical financial quantities to
-- be persisted with the same scale used by invoicing, dispatch, and evidence.
ALTER TABLE "contract_items"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,3) USING "quantity"::DECIMAL(18,3);

ALTER TABLE "delivery_products"
  ALTER COLUMN "quantity" TYPE DECIMAL(18,3) USING "quantity"::DECIMAL(18,3),
  ALTER COLUMN "deliveredQuantity" TYPE DECIMAL(18,3) USING "deliveredQuantity"::DECIMAL(18,3);
