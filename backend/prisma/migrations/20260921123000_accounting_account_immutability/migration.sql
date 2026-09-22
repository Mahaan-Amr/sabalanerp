CREATE OR REPLACE FUNCTION accounting_guard_used_account_meaning()
RETURNS trigger AS $$
DECLARE
  has_usage BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM "accounting_ledger_lines" WHERE "accountId" = OLD."id") INTO has_usage;
  IF OLD."meaningLockedAt" IS NOT NULL OR has_usage THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'حساب استفاده‌شده قابل حذف نیست';
    END IF;
    IF ROW(NEW."bookId", NEW."codeSchemeId", NEW."code", NEW."level", NEW."normalSide",
           NEW."statementRole", NEW."currencyBehavior", NEW."parentId", NEW."contraAccountId")
       IS DISTINCT FROM
       ROW(OLD."bookId", OLD."codeSchemeId", OLD."code", OLD."level", OLD."normalSide",
           OLD."statementRole", OLD."currencyBehavior", OLD."parentId", OLD."contraAccountId")
    THEN
      RAISE EXCEPTION 'معنای تاریخی حساب استفاده‌شده قابل بازتعریف نیست';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_ledger_account_meaning_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_accounts"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_used_account_meaning();
