-- Bind terminal intent evidence to a parent command in the same transaction.
-- The existing financial admission barrier remains in effect.
CREATE FUNCTION public.bind_customer_allocation_intent_result() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE intent public.accounting_customer_allocation_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM public.accounting_customer_allocation_intents
    WHERE "idempotencyKey" = NEW."idempotencyKey" FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF intent."state" <> 'PENDING' OR NEW."kind" <> 'ALLOCATION'
    OR intent."profileId" <> NEW."profileId" OR intent."ownerId" <> NEW."createdBy"
    OR intent."commandHash" <> NEW."commandHash" THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_COMMAND_MISMATCH';
  END IF;
  UPDATE public.accounting_customer_allocation_intents
    SET "state" = 'COMMITTED', "result" = NEW."result", "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = intent."id";
  RETURN NEW;
END $$;
CREATE TRIGGER bind_customer_allocation_intent_result
  AFTER INSERT ON public.accounting_customer_commands
  FOR EACH ROW EXECUTE FUNCTION public.bind_customer_allocation_intent_result();

CREATE FUNCTION public.verify_customer_allocation_intent_result() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'PENDING' THEN RAISE EXCEPTION 'ALLOCATION_INTENT_MUST_START_PENDING'; END IF;
  ELSIF NEW."state" = 'COMMITTED' AND NOT EXISTS (
    SELECT 1 FROM public.accounting_customer_commands command
    WHERE command."idempotencyKey" = NEW."idempotencyKey" AND command."kind" = 'ALLOCATION'
      AND command."profileId" = NEW."profileId" AND command."createdBy" = NEW."ownerId"
      AND command."commandHash" = NEW."commandHash" AND command."result" = NEW."result"
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_RESULT_UNPROVEN';
  ELSIF NEW."state" = 'CANCELED' AND OLD."state" = 'PENDING' AND EXISTS (
    SELECT 1 FROM public.accounting_customer_commands command
    WHERE command."idempotencyKey" = NEW."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_ALREADY_POSTED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verify_customer_allocation_intent_result
  BEFORE INSERT OR UPDATE ON public.accounting_customer_allocation_intents
  FOR EACH ROW EXECUTE FUNCTION public.verify_customer_allocation_intent_result();
