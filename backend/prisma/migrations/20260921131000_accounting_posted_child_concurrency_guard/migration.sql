-- Serialize child writes with voucher posting. The application takes this same
-- transaction-scoped advisory lock before reading a voucher for posting.
CREATE OR REPLACE FUNCTION accounting_guard_posted_child_immutability()
RETURNS trigger AS $$
DECLARE
  old_voucher_id TEXT;
  new_voucher_id TEXT;
  old_status "AccountingLedgerVoucherStatus";
  new_status "AccountingLedgerVoucherStatus";
BEGIN
  IF TG_TABLE_NAME = 'accounting_ledger_lines' THEN
    IF TG_OP <> 'INSERT' THEN old_voucher_id := OLD."voucherId"; END IF;
    IF TG_OP <> 'DELETE' THEN new_voucher_id := NEW."voucherId"; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT "voucherId" INTO old_voucher_id FROM "accounting_ledger_lines" WHERE "id" = OLD."lineId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "voucherId" INTO new_voucher_id FROM "accounting_ledger_lines" WHERE "id" = NEW."lineId";
    END IF;
  END IF;

  IF old_voucher_id IS NOT NULL AND new_voucher_id IS NOT NULL AND old_voucher_id <> new_voucher_id THEN
    PERFORM pg_advisory_xact_lock(hashtext(LEAST(old_voucher_id, new_voucher_id)));
    PERFORM pg_advisory_xact_lock(hashtext(GREATEST(old_voucher_id, new_voucher_id)));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtext(COALESCE(old_voucher_id, new_voucher_id)));
  END IF;

  IF old_voucher_id IS NOT NULL THEN
    SELECT "status" INTO old_status FROM "accounting_ledger_vouchers" WHERE "id" = old_voucher_id;
  END IF;
  IF new_voucher_id IS NOT NULL THEN
    SELECT "status" INTO new_status FROM "accounting_ledger_vouchers" WHERE "id" = new_voucher_id;
  END IF;
  IF old_status IN ('POSTED', 'REVERSED') OR new_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted accounting children are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
