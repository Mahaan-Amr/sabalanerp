-- Historical allocations retain their ordinary semantics. Partner allocations
-- must opt into the explicit immutable source branch at creation.
CREATE TYPE "PhysicalFulfillmentSourceKind" AS ENUM ('SALES_CONTRACT', 'PARTNER_CASE');
ALTER TABLE "logistics_allocation_revisions"
  ADD COLUMN "sourceKind" "PhysicalFulfillmentSourceKind" NOT NULL DEFAULT 'SALES_CONTRACT';
