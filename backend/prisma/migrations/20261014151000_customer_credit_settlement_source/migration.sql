ALTER TABLE "accounting_settlement_allocations" ALTER COLUMN "treasuryTransactionId" DROP NOT NULL;
ALTER TABLE "accounting_settlement_allocations" ADD COLUMN "creditItemId" TEXT;
ALTER TABLE "accounting_settlement_allocations" ADD CONSTRAINT "accounting_settlement_allocations_creditItemId_fkey"
  FOREIGN KEY ("creditItemId") REFERENCES "accounting_customer_open_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_settlement_allocations" ADD CONSTRAINT "accounting_settlement_allocation_source_check"
  CHECK (("treasuryTransactionId" IS NOT NULL)::integer + ("creditItemId" IS NOT NULL)::integer = 1);
CREATE INDEX "accounting_settlement_allocations_creditItemId_idx" ON "accounting_settlement_allocations"("creditItemId");

CREATE OR REPLACE FUNCTION "accounting_guard_allocation_update"()
RETURNS trigger AS $$
BEGIN
  IF OLD."reversedById" IS NULL AND NEW."reversedById" IS NOT NULL
    AND (to_jsonb(OLD) - 'reversedById') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'reversedById')
    AND EXISTS (SELECT 1 FROM "accounting_settlement_allocations" reversal
      WHERE reversal."id" = NEW."reversedById" AND reversal."reversesId" = OLD."id"
        AND reversal."treasuryTransactionId" IS NOT DISTINCT FROM OLD."treasuryTransactionId"
        AND reversal."creditItemId" IS NOT DISTINCT FROM OLD."creditItemId") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ACCOUNTING_ALLOCATION_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;
