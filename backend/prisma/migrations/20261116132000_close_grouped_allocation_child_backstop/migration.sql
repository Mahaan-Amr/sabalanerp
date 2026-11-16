-- The parent intent and child lineage are necessary but cannot grant admission.
-- Keep the application role unable to insert a grouped child while the
-- migration-owned control is closed, even if an internal writer skips its guard.
CREATE FUNCTION public.require_active_grouped_allocation_child() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  admitted boolean;
BEGIN
  IF NEW."parentCommandKey" IS NULL THEN RETURN NULL; END IF;
  SELECT state = 'ACTIVE' INTO admitted
    FROM public.customer_allocation_release_control
    WHERE id = 'grouped-allocation' FOR SHARE;
  IF admitted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CUSTOMER_SOURCE_SHARES_CLOSED';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER require_active_grouped_allocation_child
  AFTER INSERT ON public.accounting_settlement_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.require_active_grouped_allocation_child();
