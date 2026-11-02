-- Widen only quantity columns. Existing values and immutable evidence are preserved.
ALTER TABLE "accounting_supplier_invoice_lines" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_inventory_events" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_inventory_valuation_layers" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_inventory_layer_consumptions" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_inventory_reservations" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_production_cost_pools" ALTER COLUMN "basisQuantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_production_outputs" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
ALTER TABLE "accounting_inventory_migration_items" ALTER COLUMN "quantity" TYPE DECIMAL(65,30);
