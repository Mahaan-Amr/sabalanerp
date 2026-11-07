-- Preserve every issued number. Refuse the restart if the new range is already in use.
BEGIN;
LOCK TABLE accounting_dispatch_waybills IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting_dispatch_waybills WHERE number >= 0 AND number < 1000000001) THEN
    RAISE EXCEPTION 'Cannot restart waybill numbering: the new range already contains issued numbers';
  END IF;
END $$;

ALTER SEQUENCE accounting_dispatch_waybill_number_seq MINVALUE 0;
SELECT setval('accounting_dispatch_waybill_number_seq', 0, false);
COMMIT;
