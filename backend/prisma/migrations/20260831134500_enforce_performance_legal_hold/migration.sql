ALTER TABLE "performance_legal_holds" ADD COLUMN "aggregateIdHash" TEXT NOT NULL;
CREATE INDEX "performance_legal_holds_aggregate_hash_status_idx" ON "performance_legal_holds"("aggregateType", "aggregateIdHash", "status");

CREATE OR REPLACE FUNCTION performance_guard_deletion_receipt()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "performance_legal_holds"
    WHERE "aggregateType" = NEW."aggregateType"
      AND "aggregateIdHash" = NEW."aggregateIdHash"
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'personnel performance deletion blocked by active legal hold';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performance_deletion_receipts_legal_hold_guard
BEFORE INSERT ON "performance_deletion_receipts"
FOR EACH ROW EXECUTE FUNCTION performance_guard_deletion_receipt();
