ALTER TABLE "products"
  ADD COLUMN "preparedSalesUnit" TEXT NOT NULL DEFAULT 'count',
  ADD COLUMN "volumetricSalesUnit" TEXT NOT NULL DEFAULT 'ton';

ALTER TABLE "products"
  ADD CONSTRAINT "products_prepared_sales_unit_check"
    CHECK ("preparedSalesUnit" IN ('count', 'squareMeter', 'ton')),
  ADD CONSTRAINT "products_volumetric_sales_unit_check"
    CHECK ("volumetricSalesUnit" IN ('count', 'squareMeter', 'ton'));
