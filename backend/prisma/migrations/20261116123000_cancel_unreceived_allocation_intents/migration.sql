CREATE FUNCTION public.serialize_customer_allocation_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."kind" = 'ALLOCATION' THEN
    INSERT INTO public.accounting_customer_allocation_fences ("profileId") VALUES (NEW."profileId")
      ON CONFLICT ("profileId") DO UPDATE SET "profileId" = EXCLUDED."profileId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER serialize_customer_allocation_parent
  BEFORE INSERT ON public.accounting_customer_commands
  FOR EACH ROW EXECUTE FUNCTION public.serialize_customer_allocation_parent();

CREATE OR REPLACE FUNCTION public.verify_customer_allocation_intent_result() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."state" NOT IN ('PENDING', 'CANCELED') THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_INITIAL_STATE_INVALID';
  END IF;
  IF NEW."state" = 'COMMITTED' AND NOT EXISTS (
    SELECT 1 FROM public.accounting_customer_commands command
    WHERE command."idempotencyKey" = NEW."idempotencyKey" AND command."kind" = 'ALLOCATION'
      AND command."profileId" = NEW."profileId" AND command."createdBy" = NEW."ownerId"
      AND command."commandHash" = NEW."commandHash" AND command."result" = NEW."result"
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_RESULT_UNPROVEN';
  ELSIF NEW."state" = 'CANCELED' AND EXISTS (
    SELECT 1 FROM public.accounting_customer_commands command
    WHERE command."idempotencyKey" = NEW."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_ALREADY_POSTED';
  END IF;
  RETURN NEW;
END $$;
