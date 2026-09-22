-- A posted voucher cannot gain, lose, change, or move a journal line or
-- dimension. The original trigger guarded UPDATE/DELETE only and inspected
-- just one side of a move; this replacement deliberately covers every case.
CREATE OR REPLACE FUNCTION accounting_guard_posted_child_immutability()
RETURNS trigger AS $$
DECLARE
  old_status "AccountingLedgerVoucherStatus";
  new_status "AccountingLedgerVoucherStatus";
BEGIN
  IF TG_TABLE_NAME = 'accounting_ledger_lines' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT "status" INTO old_status FROM "accounting_ledger_vouchers" WHERE "id" = OLD."voucherId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "status" INTO new_status FROM "accounting_ledger_vouchers" WHERE "id" = NEW."voucherId";
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      SELECT v."status" INTO old_status
      FROM "accounting_ledger_lines" l
      JOIN "accounting_ledger_vouchers" v ON v."id" = l."voucherId"
      WHERE l."id" = OLD."lineId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT v."status" INTO new_status
      FROM "accounting_ledger_lines" l
      JOIN "accounting_ledger_vouchers" v ON v."id" = l."voucherId"
      WHERE l."id" = NEW."lineId";
    END IF;
  END IF;

  IF old_status IN ('POSTED', 'REVERSED') OR new_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'Posted accounting children are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "accounting_ledger_line_immutability" ON "accounting_ledger_lines";
CREATE TRIGGER "accounting_ledger_line_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "accounting_ledger_lines"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_posted_child_immutability();

DROP TRIGGER IF EXISTS "accounting_ledger_dimension_immutability" ON "accounting_ledger_line_dimensions";
CREATE TRIGGER "accounting_ledger_dimension_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "accounting_ledger_line_dimensions"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_posted_child_immutability();
