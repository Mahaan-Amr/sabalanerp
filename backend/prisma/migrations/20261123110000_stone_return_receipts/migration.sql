CREATE TABLE "stone_return_receipts" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(65,30) NOT NULL,
    "acceptedQuantity" DECIMAL(65,30) NOT NULL,
    "rejectedQuantity" DECIMAL(65,30) NOT NULL,
    "rejectionReason" TEXT,
    "guardReturnMovementId" TEXT,
    "inventoryIdentityId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stone_return_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stone_return_receipts_quantity_check" CHECK (
      "receivedQuantity" > 0 AND "acceptedQuantity" >= 0 AND "rejectedQuantity" >= 0
      AND "receivedQuantity" = "acceptedQuantity" + "rejectedQuantity"
      AND ("acceptedQuantity" > 0) = ("inventoryIdentityId" IS NOT NULL)
      AND ("rejectedQuantity" > 0) = ("rejectionReason" IS NOT NULL)
      AND ("rejectionReason" IS NULL OR length(btrim("rejectionReason")) BETWEEN 1 AND 2000)
      AND "unit" IN ('squareMeter', 'meter', 'count', 'ton')
      AND ("unit" <> 'count' OR ("receivedQuantity" = trunc("receivedQuantity")
        AND "acceptedQuantity" = trunc("acceptedQuantity")))
    )
);

CREATE UNIQUE INDEX "stone_return_receipts_inventoryIdentityId_key" ON "stone_return_receipts"("inventoryIdentityId");
CREATE UNIQUE INDEX "stone_return_receipts_createdBy_requestId_key" ON "stone_return_receipts"("createdBy", "requestId");
CREATE INDEX "stone_return_receipts_createdAt_id_idx" ON "stone_return_receipts"("createdAt", "id");
CREATE INDEX "stone_return_receipts_customerId_productId_unit_idx" ON "stone_return_receipts"("customerId", "productId", "unit");
CREATE INDEX "stone_return_receipts_productId_idx" ON "stone_return_receipts"("productId");
CREATE UNIQUE INDEX "stone_return_receipts_guard_product_unit_key" ON "stone_return_receipts"("guardReturnMovementId", "productId", "unit");

ALTER TABLE "stone_return_receipts" ADD CONSTRAINT "stone_return_receipts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stone_return_receipts" ADD CONSTRAINT "stone_return_receipts_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stone_return_receipts" ADD CONSTRAINT "stone_return_receipts_guardReturnMovementId_fkey"
  FOREIGN KEY ("guardReturnMovementId") REFERENCES "security_vehicle_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stone_return_receipts" ADD CONSTRAINT "stone_return_receipts_inventoryIdentityId_fkey"
  FOREIGN KEY ("inventoryIdentityId") REFERENCES "accounting_inventory_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "stone_return_receipts_immutability" BEFORE UPDATE OR DELETE ON "stone_return_receipts"
  FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    REVOKE ALL ON TABLE public.stone_return_receipts FROM sabalan_application_runtime;
    GRANT SELECT, INSERT ON TABLE public.stone_return_receipts TO sabalan_application_runtime;
  END IF;
END $$;
