-- Dormant release control. A later reviewed controller migration must replace this
-- fence before any activation; application code has no activation path.
CREATE TABLE public.customer_allocation_release_control (
  id text PRIMARY KEY CHECK (id = 'grouped-allocation'),
  state text NOT NULL DEFAULT 'CLOSED' CHECK (state = 'CLOSED'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.customer_allocation_release_control (id) VALUES ('grouped-allocation');

CREATE FUNCTION public.keep_customer_allocation_control_closed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROL_IMMUTABLE';
END $$;
CREATE TRIGGER keep_customer_allocation_control_closed
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.customer_allocation_release_control
  FOR EACH STATEMENT EXECUTE FUNCTION public.keep_customer_allocation_control_closed();
