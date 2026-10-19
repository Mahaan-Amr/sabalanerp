-- Deny-only staging barrier. This migration grants no activation authority.
-- One DO statement makes its own installation atomic, including native Prisma
-- use. The specialized protected expansion must additionally include all seven
-- preceding financial migrations and their history in its owned transaction.
DO $install_customer_barrier$
DECLARE
  guarded_table TEXT;
BEGIN
  -- Adoption must inspect a fresh supported snapshot after all old/new writers
  -- have completed, retaining these locks until the guards commit together.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'CUSTOMER_SEMANTIC_INSTALL_ISOLATION_UNSUPPORTED' USING ERRCODE = '55000';
  END IF;
  IF current_setting('lock_timeout')::interval = interval '0'
      OR current_setting('lock_timeout')::interval > interval '1 second' THEN
    PERFORM set_config('lock_timeout', '1000ms', true);
  END IF;
  LOCK TABLE public.accounting_check_instrument_events, public.accounting_check_instruments,
    public.accounting_customer_commands, public.accounting_customer_opening_attributions,
    public.accounting_customer_opening_reviews, public.accounting_customer_receipt_adjustments,
    public.accounting_customer_receipt_resolutions, public.accounting_settlement_allocation_lines,
    public.accounting_settlement_allocations, public.accounting_treasury_transactions
    IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.accounting_settlement_allocations
      WHERE "treasuryTransactionId" IS NULL OR "creditItemId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.accounting_customer_opening_reviews)
    OR EXISTS (SELECT 1 FROM public.accounting_customer_receipt_adjustments)
    OR EXISTS (SELECT 1 FROM public.accounting_customer_commands)
    OR EXISTS (SELECT 1 FROM public.accounting_customer_opening_attributions)
    OR EXISTS (SELECT 1 FROM public.accounting_customer_receipt_resolutions)
    OR EXISTS (SELECT 1 FROM public.accounting_treasury_transactions WHERE "componentKind" <> 'BANK'
      OR "receiptGroupId" IS NOT NULL OR "checkInstrumentId" IS NOT NULL OR "sourceParentId" IS NOT NULL
      OR "sourceAssetLedgerId" IS NOT NULL OR "legacyRefundId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.accounting_check_instruments WHERE "clearedRials" <> 0 OR "unpaidRials" <> 0
      OR status = 'PARTIAL_SETTLED')
    OR EXISTS (SELECT 1 FROM public.accounting_check_instrument_events WHERE "idempotencyKey" IS NOT NULL
      OR "eventType" IN ('PARTIAL_BANK_OUTCOME', 'PARTIAL_SETTLED', 'RECIPIENT_RETURNED')) THEN
    RAISE EXCEPTION 'CUSTOMER_SEMANTIC_BASELINE_INCOMPATIBLE';
  END IF;

  CREATE TABLE public.online_financial_compatibility_barriers (
    capability TEXT PRIMARY KEY CHECK (capability = 'customer-source-shares/v1'),
    state TEXT NOT NULL CHECK (state = 'CLOSED'),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO public.online_financial_compatibility_barriers (capability, state)
    VALUES ('customer-source-shares/v1', 'CLOSED');
  REVOKE ALL ON public.online_financial_compatibility_barriers FROM PUBLIC;

  CREATE FUNCTION public.sabalan_require_customer_source_shares() RETURNS void
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $require_closed$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.online_financial_compatibility_barriers
        WHERE capability = 'customer-source-shares/v1' AND state = 'CLOSED') THEN
      RAISE EXCEPTION 'CUSTOMER_SEMANTIC_BARRIER_STATE_UNPROVEN' USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'CUSTOMER_SOURCE_SHARES_CLOSED' USING ERRCODE = '55000';
  END;
  $require_closed$;

  CREATE FUNCTION public.sabalan_protect_customer_barrier() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $protect_closed$
  BEGIN
    RAISE EXCEPTION 'CUSTOMER_SEMANTIC_BARRIER_IMMUTABLE' USING ERRCODE = '55000';
  END;
  $protect_closed$;
  CREATE TRIGGER customer_semantic_barrier_immutable
    BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.online_financial_compatibility_barriers
    FOR EACH STATEMENT EXECUTE FUNCTION public.sabalan_protect_customer_barrier();

  CREATE FUNCTION public.sabalan_guard_customer_credit_source() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $guard_credit$
  BEGIN
    IF TG_OP <> 'DELETE' AND (NEW."treasuryTransactionId" IS NULL OR NEW."creditItemId" IS NOT NULL) THEN
      PERFORM public.sabalan_require_customer_source_shares();
    END IF;
    IF TG_OP <> 'INSERT' AND (OLD."treasuryTransactionId" IS NULL OR OLD."creditItemId" IS NOT NULL) THEN
      PERFORM public.sabalan_require_customer_source_shares();
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END;
  $guard_credit$;
  CREATE TRIGGER customer_credit_source_compatibility
    BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_settlement_allocations
    FOR EACH ROW EXECUTE FUNCTION public.sabalan_guard_customer_credit_source();

  CREATE FUNCTION public.sabalan_reject_customer_semantic_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $reject_semantic$
  BEGIN
    PERFORM public.sabalan_require_customer_source_shares();
    RAISE EXCEPTION 'CUSTOMER_SEMANTIC_BARRIER_STATE_UNPROVEN' USING ERRCODE = '55000';
  END;
  $reject_semantic$;
  FOREACH guarded_table IN ARRAY ARRAY['accounting_customer_opening_reviews',
    'accounting_customer_receipt_adjustments', 'accounting_customer_commands',
    'accounting_customer_opening_attributions', 'accounting_customer_receipt_resolutions']
  LOOP
    EXECUTE format('CREATE TRIGGER customer_semantic_compatibility BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.sabalan_reject_customer_semantic_mutation()', guarded_table);
    EXECUTE format('CREATE TRIGGER customer_semantic_truncate_compatibility BEFORE TRUNCATE ON public.%I
      FOR EACH STATEMENT EXECUTE FUNCTION public.sabalan_reject_customer_semantic_mutation()', guarded_table);
  END LOOP;

  CREATE FUNCTION public.sabalan_guard_customer_semantic_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $guard_fields$
  DECLARE
    representation JSONB;
  BEGIN
    -- Inspect both representations: clearing or moving an existing new-format
    -- row is not a route around a closed compatibility boundary.
    FOR representation IN SELECT value FROM jsonb_array_elements(
      jsonb_build_array(CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
                       CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END))
    LOOP
      IF representation = 'null'::jsonb THEN CONTINUE; END IF;
      IF TG_TABLE_NAME = 'accounting_treasury_transactions' THEN
        IF representation->>'componentKind' IS DISTINCT FROM 'BANK'
          OR representation->>'receiptGroupId' IS NOT NULL OR representation->>'checkInstrumentId' IS NOT NULL
          OR representation->>'sourceParentId' IS NOT NULL OR representation->>'sourceAssetLedgerId' IS NOT NULL
          OR representation->>'legacyRefundId' IS NOT NULL THEN
          PERFORM public.sabalan_require_customer_source_shares();
        END IF;
      ELSIF TG_TABLE_NAME = 'accounting_check_instruments' THEN
        IF (representation->>'clearedRials')::numeric <> 0 OR (representation->>'unpaidRials')::numeric <> 0
          OR representation->>'status' = 'PARTIAL_SETTLED' THEN
          PERFORM public.sabalan_require_customer_source_shares();
        END IF;
      ELSIF TG_TABLE_NAME = 'accounting_check_instrument_events' THEN
        IF representation->>'idempotencyKey' IS NOT NULL
          OR representation->>'eventType' IN ('PARTIAL_BANK_OUTCOME', 'PARTIAL_SETTLED', 'RECIPIENT_RETURNED') THEN
          PERFORM public.sabalan_require_customer_source_shares();
        END IF;
      ELSIF TG_TABLE_NAME = 'accounting_settlement_allocation_lines' THEN
        IF EXISTS (SELECT 1 FROM public.accounting_settlement_allocations WHERE id = representation->>'allocationId'
          AND ("treasuryTransactionId" IS NULL OR "creditItemId" IS NOT NULL)) THEN
          PERFORM public.sabalan_require_customer_source_shares();
        END IF;
      ELSE
        RAISE EXCEPTION 'CUSTOMER_SEMANTIC_BARRIER_STATE_UNPROVEN' USING ERRCODE = '55000';
      END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END;
  $guard_fields$;
  FOREACH guarded_table IN ARRAY ARRAY['accounting_treasury_transactions', 'accounting_check_instruments',
    'accounting_check_instrument_events', 'accounting_settlement_allocation_lines']
  LOOP
    EXECUTE format('CREATE TRIGGER customer_semantic_fields_compatibility BEFORE INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.sabalan_guard_customer_semantic_fields()', guarded_table);
    EXECUTE format('CREATE TRIGGER customer_semantic_truncate_compatibility BEFORE TRUNCATE ON public.%I
      FOR EACH STATEMENT EXECUTE FUNCTION public.sabalan_reject_customer_semantic_mutation()', guarded_table);
  END LOOP;
  CREATE TRIGGER customer_semantic_truncate_compatibility BEFORE TRUNCATE ON public.accounting_settlement_allocations
    FOR EACH STATEMENT EXECUTE FUNCTION public.sabalan_reject_customer_semantic_mutation();
END;
$install_customer_barrier$;
