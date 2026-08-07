DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum value JOIN pg_type kind ON kind.oid = value.enumtypid
    WHERE kind.typname = 'AccountingDispatchWaybillStatus' AND value.enumlabel = 'EXITED') THEN
    ALTER TYPE "AccountingDispatchWaybillStatus" RENAME VALUE 'EXITED' TO 'EXIT_RECORDED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchBuyerSmsStatus') THEN
    CREATE TYPE "DispatchBuyerSmsStatus" AS ENUM ('PENDING','RETRY','SENDING','SENT','UNKNOWN','NEEDS_ATTENTION');
    ALTER TABLE "dispatch_buyer_sms_intents" DROP CONSTRAINT IF EXISTS "dispatch_buyer_sms_intents_status_check";
    ALTER TABLE "dispatch_buyer_sms_intents" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "dispatch_buyer_sms_intents" ALTER COLUMN "status" TYPE "DispatchBuyerSmsStatus" USING "status"::"DispatchBuyerSmsStatus";
    ALTER TABLE "dispatch_buyer_sms_intents" ALTER COLUMN "status" SET DEFAULT 'PENDING';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION protect_waybill_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> NEW."status" AND NOT (OLD."status" = 'ISSUED' AND NEW."status" IN ('VOIDED','EXIT_RECORDED')) THEN
    RAISE EXCEPTION 'invalid dispatch waybill status transition';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
