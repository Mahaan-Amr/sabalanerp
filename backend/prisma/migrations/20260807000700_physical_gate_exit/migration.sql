ALTER TYPE "AccountingDispatchWaybillStatus" ADD VALUE IF NOT EXISTS 'EXIT_RECORDED';
CREATE TYPE "DispatchBuyerSmsStatus" AS ENUM ('PENDING','RETRY','SENDING','SENT','UNKNOWN','NEEDS_ATTENTION');

CREATE TABLE "guard_physical_exits" (
  "id" TEXT NOT NULL,
  "authorizationId" TEXT NOT NULL,
  "waybillId" TEXT NOT NULL,
  "queueTurnId" TEXT NOT NULL,
  "allocationRevisionId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL,
  CONSTRAINT "guard_physical_exits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "guard_physical_exits_authorizationId_key" ON "guard_physical_exits"("authorizationId");
CREATE UNIQUE INDEX "guard_physical_exits_waybillId_key" ON "guard_physical_exits"("waybillId");
CREATE UNIQUE INDEX "guard_physical_exits_queueTurnId_key" ON "guard_physical_exits"("queueTurnId");
CREATE UNIQUE INDEX "guard_physical_exits_allocationRevisionId_key" ON "guard_physical_exits"("allocationRevisionId");
CREATE UNIQUE INDEX "guard_physical_exits_integrityHash_key" ON "guard_physical_exits"("integrityHash");
CREATE INDEX "guard_physical_exits_occurredAt_idx" ON "guard_physical_exits"("occurredAt");

CREATE TABLE "dispatch_buyer_sms_intents" (
  "id" TEXT NOT NULL,
  "physicalExitId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "phoneNumber" TEXT,
  "dispatchNumber" TEXT NOT NULL,
  "vehiclePlate" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "DispatchBuyerSmsStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "unknownAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_buyer_sms_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dispatch_buyer_sms_intents_attempt_count_check" CHECK ("attemptCount" >= 0)
);
CREATE UNIQUE INDEX "dispatch_buyer_sms_intents_physicalExitId_key" ON "dispatch_buyer_sms_intents"("physicalExitId");
CREATE UNIQUE INDEX "dispatch_buyer_sms_intents_idempotencyKey_key" ON "dispatch_buyer_sms_intents"("idempotencyKey");
CREATE INDEX "dispatch_buyer_sms_intents_status_availableAt_idx" ON "dispatch_buyer_sms_intents"("status", "availableAt");

ALTER TABLE "guard_physical_exits" ADD CONSTRAINT "guard_physical_exits_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "dispatch_exit_authorizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_physical_exits" ADD CONSTRAINT "guard_physical_exits_waybillId_fkey" FOREIGN KEY ("waybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_physical_exits" ADD CONSTRAINT "guard_physical_exits_queueTurnId_fkey" FOREIGN KEY ("queueTurnId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_physical_exits" ADD CONSTRAINT "guard_physical_exits_allocationRevisionId_fkey" FOREIGN KEY ("allocationRevisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispatch_buyer_sms_intents" ADD CONSTRAINT "dispatch_buyer_sms_intents_physicalExitId_fkey" FOREIGN KEY ("physicalExitId") REFERENCES "guard_physical_exits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER guard_physical_exit_append_only BEFORE UPDATE OR DELETE ON "guard_physical_exits" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();

CREATE OR REPLACE FUNCTION protect_dispatch_buyer_sms_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."physicalExitId" <> OLD."physicalExitId" OR NEW."idempotencyKey" <> OLD."idempotencyKey"
    OR NEW."phoneNumber" IS DISTINCT FROM OLD."phoneNumber" OR NEW."dispatchNumber" <> OLD."dispatchNumber"
    OR NEW."vehiclePlate" <> OLD."vehiclePlate" OR NEW."payload" <> OLD."payload" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'dispatch buyer SMS intent identity is immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER dispatch_buyer_sms_identity_immutable BEFORE UPDATE ON "dispatch_buyer_sms_intents" FOR EACH ROW EXECUTE FUNCTION protect_dispatch_buyer_sms_identity();
CREATE TRIGGER dispatch_buyer_sms_no_delete BEFORE DELETE ON "dispatch_buyer_sms_intents" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();

CREATE OR REPLACE FUNCTION protect_waybill_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> NEW."status" AND NOT (OLD."status" = 'ISSUED' AND NEW."status" IN ('VOIDED','EXIT_RECORDED')) THEN
    RAISE EXCEPTION 'invalid dispatch waybill status transition';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER accounting_dispatch_waybill_status_transition BEFORE UPDATE ON "accounting_dispatch_waybills" FOR EACH ROW EXECUTE FUNCTION protect_waybill_status_transition();
