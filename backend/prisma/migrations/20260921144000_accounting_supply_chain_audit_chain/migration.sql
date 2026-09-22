ALTER TABLE "accounting_inventory_migration_items"
  ADD COLUMN "rawPayload" JSONB;

ALTER TABLE "accounting_supply_chain_command_audits"
  ADD COLUMN "sequence" BIGINT,
  ADD COLUMN "previousHash" TEXT,
  ADD COLUMN "entryHash" TEXT;

WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id")::BIGINT AS sequence,
         md5("id" || ':' || "commandHash") AS entry_hash
  FROM "accounting_supply_chain_command_audits"
), linked AS (
  SELECT "id", sequence, entry_hash, lag(entry_hash) OVER (ORDER BY sequence) AS previous_hash
  FROM ordered
)
UPDATE "accounting_supply_chain_command_audits" AS audit
SET "sequence" = linked.sequence, "entryHash" = linked.entry_hash, "previousHash" = linked.previous_hash
FROM linked WHERE audit."id" = linked."id";

ALTER TABLE "accounting_supply_chain_command_audits"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "entryHash" SET NOT NULL;

CREATE UNIQUE INDEX "accounting_supply_chain_command_audits_sequence_key"
  ON "accounting_supply_chain_command_audits"("sequence");
CREATE UNIQUE INDEX "accounting_supply_chain_command_audits_entryHash_key"
  ON "accounting_supply_chain_command_audits"("entryHash");
