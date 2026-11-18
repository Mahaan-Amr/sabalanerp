CREATE TABLE public.accounting_customer_command_key_fences (
  "idempotencyKey" TEXT NOT NULL PRIMARY KEY
);

CREATE FUNCTION public.serialize_customer_command_key_within(command_key TEXT) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  INSERT INTO public.accounting_customer_command_key_fences ("idempotencyKey") VALUES (command_key)
    ON CONFLICT ("idempotencyKey") DO UPDATE SET "idempotencyKey" = EXCLUDED."idempotencyKey";
$$;

CREATE OR REPLACE FUNCTION public.serialize_customer_allocation_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."kind" = 'ALLOCATION' THEN
    INSERT INTO public.accounting_customer_allocation_fences ("profileId") VALUES (NEW."profileId")
      ON CONFLICT ("profileId") DO UPDATE SET "profileId" = EXCLUDED."profileId";
  END IF;
  PERFORM public.serialize_customer_command_key_within(NEW."idempotencyKey");
  RETURN NEW;
END $$;

CREATE FUNCTION public.serialize_customer_allocation_intent_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.serialize_customer_command_key_within(NEW."idempotencyKey");
  IF EXISTS (
    SELECT 1 FROM public.accounting_customer_commands command
    WHERE command."idempotencyKey" = NEW."idempotencyKey"
  ) THEN
    RAISE EXCEPTION 'ALLOCATION_INTENT_ALREADY_POSTED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER serialize_customer_allocation_intent_insert
  BEFORE INSERT ON public.accounting_customer_allocation_intents
  FOR EACH ROW EXECUTE FUNCTION public.serialize_customer_allocation_intent_insert();
