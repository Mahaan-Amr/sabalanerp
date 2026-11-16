-- Lineage is additive; historical receipt allocations retain their existing shape.
-- Admission remains closed in the application until a protected controller exists.
ALTER TABLE public.accounting_settlement_allocations
  ADD COLUMN "parentCommandKey" text,
  ADD COLUMN "sourcePlanHash" text;
ALTER TABLE public.accounting_settlement_allocations
  ADD CONSTRAINT grouped_allocation_lineage_pair CHECK
    (("parentCommandKey" IS NULL AND "sourcePlanHash" IS NULL)
      OR ("parentCommandKey" IS NOT NULL AND "sourcePlanHash" ~ '^[0-9a-f]{64}$'));
CREATE INDEX accounting_settlement_allocations_parent_command_idx
  ON public.accounting_settlement_allocations ("parentCommandKey")
  WHERE "parentCommandKey" IS NOT NULL;

CREATE FUNCTION public.verify_grouped_allocation_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  intent public.accounting_customer_allocation_intents%ROWTYPE;
  parent public.accounting_customer_commands%ROWTYPE;
  plan jsonb;
  source_row jsonb;
  actual_count integer;
  planned_count integer;
BEGIN
  -- A credit reversal is legal only when its original child has proved lineage.
  IF NEW."reversesId" IS NOT NULL THEN
    IF NEW."creditItemId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounting_settlement_allocations original
      WHERE original.id = NEW."reversesId" AND original."creditItemId" = NEW."creditItemId"
        AND original."parentCommandKey" IS NOT NULL
        AND original."sourcePlanHash" IS NOT NULL
    ) THEN RAISE EXCEPTION 'GROUPED_ALLOCATION_REVERSAL_UNPROVEN'; END IF;
    RETURN NULL;
  END IF;
  IF NEW."parentCommandKey" IS NULL THEN
    IF NEW."creditItemId" IS NOT NULL THEN
      RAISE EXCEPTION 'GROUPED_ALLOCATION_CHILD_UNPROVEN';
    END IF;
    RETURN NULL;
  END IF;
  SELECT * INTO intent FROM public.accounting_customer_allocation_intents
    WHERE "idempotencyKey" = NEW."parentCommandKey" AND "state" = 'COMMITTED'
      AND "commandHash" = NEW."sourcePlanHash";
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUPED_ALLOCATION_INTENT_UNPROVEN'; END IF;
  SELECT * INTO parent FROM public.accounting_customer_commands
    WHERE "idempotencyKey" = NEW."parentCommandKey" AND "kind" = 'ALLOCATION'
      AND "profileId" = intent."profileId" AND "createdBy" = intent."ownerId"
      AND "commandHash" = intent."commandHash" AND "result" = intent."result";
  IF NOT FOUND OR (parent."result" -> 'allocationIds' @> to_jsonb(NEW.id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'GROUPED_ALLOCATION_PARENT_UNPROVEN';
  END IF;
  IF NEW."createdBy" <> intent."ownerId"
    OR NEW."idempotencyKey" <> NEW."parentCommandKey" || ':' ||
      COALESCE(NEW."creditItemId", NEW."treasuryTransactionId") THEN
    RAISE EXCEPTION 'GROUPED_ALLOCATION_CHILD_IDENTITY_MISMATCH';
  END IF;
  plan := intent.command -> 'sourceAllocations';
  IF jsonb_typeof(plan) <> 'array' THEN RAISE EXCEPTION 'GROUPED_ALLOCATION_PLAN_INVALID'; END IF;
  SELECT value INTO source_row FROM jsonb_array_elements(plan) AS value
    WHERE (NEW."creditItemId" IS NOT NULL AND value ->> 'creditItemId' = NEW."creditItemId"
      AND value ->> 'receiptId' IS NULL)
       OR (NEW."treasuryTransactionId" IS NOT NULL AND value ->> 'receiptId' = NEW."treasuryTransactionId"
      AND value ->> 'creditItemId' IS NULL);
  IF NOT FOUND OR jsonb_typeof(source_row -> 'allocations') <> 'array' THEN
    RAISE EXCEPTION 'GROUPED_ALLOCATION_SOURCE_MISMATCH';
  END IF;
  IF NEW."creditItemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounting_customer_open_items source
    WHERE source.id = NEW."creditItemId" AND source."profileId" = intent."profileId"
  ) OR NEW."treasuryTransactionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounting_treasury_transactions source
    WHERE source.id = NEW."treasuryTransactionId" AND source."profileId" = intent."profileId"
  ) THEN RAISE EXCEPTION 'GROUPED_ALLOCATION_OWNER_MISMATCH'; END IF;
  SELECT count(*) INTO actual_count FROM public.accounting_settlement_allocation_lines
    WHERE "allocationId" = NEW.id;
  SELECT count(*) INTO planned_count FROM jsonb_array_elements(source_row -> 'allocations');
  IF planned_count = 0 OR actual_count <> planned_count OR EXISTS (
    SELECT 1 FROM public.accounting_settlement_allocation_lines line
    WHERE line."allocationId" = NEW.id AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(source_row -> 'allocations') AS item
      WHERE item ->> 'openItemId' = line."openItemId"
        AND (item ->> 'amountRials') ~ '^[0-9]+$'
        AND (item ->> 'amountRials')::numeric = line."amountRials"
    )
  ) THEN RAISE EXCEPTION 'GROUPED_ALLOCATION_LINES_MISMATCH'; END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER verify_grouped_allocation_child
  AFTER INSERT ON public.accounting_settlement_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.verify_grouped_allocation_child();
