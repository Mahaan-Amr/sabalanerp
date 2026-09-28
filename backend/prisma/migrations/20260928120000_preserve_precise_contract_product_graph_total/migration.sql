-- Preserve all 20 existing integer digits and add commercial fractional precision.
-- Historical graph/contract snapshots and financial obligations are unchanged.
ALTER TABLE "sales_contract_product_graph_states"
  ALTER COLUMN "totalAmountToman" TYPE DECIMAL(32,12);
