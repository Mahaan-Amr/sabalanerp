-- Denial/recovery evidence only. This migration does not enable financial writes.
CREATE TABLE "accounting_customer_allocation_intents" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "command" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_customer_allocation_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "allocation_intent_profile_fkey" FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "allocation_intent_state_check" CHECK (
    ("state" IN ('PENDING', 'CANCELED') AND "result" IS NULL)
    OR ("state" = 'COMMITTED' AND "result" IS NOT NULL)
  ),
  CONSTRAINT "allocation_intent_hash_check" CHECK ("commandHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "accounting_customer_allocation_intents_idempotencyKey_key"
  ON "accounting_customer_allocation_intents"("idempotencyKey");
CREATE UNIQUE INDEX "allocation_intent_one_pending_per_profile"
  ON "accounting_customer_allocation_intents"("profileId") WHERE "state" = 'PENDING';
CREATE INDEX "accounting_customer_allocation_intents_profileId_createdAt_idx"
  ON "accounting_customer_allocation_intents"("profileId", "createdAt");

CREATE FUNCTION "protect_allocation_intent_evidence"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ALLOCATION_INTENT_EVIDENCE_IMMUTABLE'; END IF;
  IF ROW(NEW."id", NEW."profileId", NEW."accountId", NEW."ownerId", NEW."idempotencyKey", NEW."commandHash", NEW."command", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."id", OLD."profileId", OLD."accountId", OLD."ownerId", OLD."idempotencyKey", OLD."commandHash", OLD."command", OLD."createdAt")
    OR OLD."state" <> 'PENDING' OR NEW."state" NOT IN ('COMMITTED', 'CANCELED') THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_EVIDENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "allocation_intent_evidence_immutable" BEFORE UPDATE OR DELETE ON "accounting_customer_allocation_intents"
  FOR EACH ROW EXECUTE FUNCTION "protect_allocation_intent_evidence"();
