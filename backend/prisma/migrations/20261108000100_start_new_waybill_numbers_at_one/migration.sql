BEGIN;
LOCK TABLE accounting_dispatch_waybills IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE current_number bigint;
BEGIN
  SELECT last_value INTO current_number FROM accounting_dispatch_waybill_number_seq;
  IF current_number = 0 THEN
    IF EXISTS (SELECT 1 FROM accounting_dispatch_waybills WHERE number = 1) THEN
      RAISE EXCEPTION 'Cannot start waybill sequence at 1: number 1 already exists';
    END IF;
    ALTER SEQUENCE accounting_dispatch_waybill_number_seq MINVALUE 1 RESTART WITH 1;
  ELSE
    ALTER SEQUENCE accounting_dispatch_waybill_number_seq MINVALUE 1;
  END IF;
END $$;
COMMIT;
