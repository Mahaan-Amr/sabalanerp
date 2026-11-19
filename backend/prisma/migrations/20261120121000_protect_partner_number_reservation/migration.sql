BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep the number registry writable only through the existing reservation triggers.
CREATE OR REPLACE FUNCTION public.partner_reserve_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_NAME <> 'partner_number' OR TG_OP <> 'INSERT'
    OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' OR TG_NARGS <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invalid Partner number reservation trigger';
  END IF;

  IF TG_RELID = 'public.partner_sale_cases'::regclass THEN
    INSERT INTO public.partner_commercial_numbers (number, "caseId", purpose)
      VALUES (NEW."caseNumber", NEW.id, 'CASE');
  ELSIF TG_RELID = 'public.sabalan_to_partner_sale_records'::regclass THEN
    INSERT INTO public.partner_commercial_numbers (number, "caseId", purpose)
      VALUES (NEW."recordNumber", NEW."caseId", 'INTERNAL');
  ELSIF TG_RELID = 'public.sales_contracts'::regclass THEN
    IF NEW."partnerCaseId" IS NOT NULL THEN
      INSERT INTO public.partner_commercial_numbers (number, "caseId", purpose)
        VALUES (NEW."contractNumber", NEW."partnerCaseId", 'CUSTOMER');
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invalid Partner number reservation trigger';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.partner_reserve_number()
  FROM PUBLIC, sabalan_application_runtime, sabalan_allocation_controller;

COMMIT;
