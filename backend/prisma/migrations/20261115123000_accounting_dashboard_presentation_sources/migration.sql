-- Contract summaries and deadline rows expose customer and actor names.
-- Refresh those presentations when their source changes, without treating
-- routine unrelated user updates as Accounting mutations.
CREATE FUNCTION mark_accounting_dashboard_customer_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  internal_id text;
  customer_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND
      (OLD."firstName", OLD."lastName", OLD."companyName", OLD."nationalCode",
       OLD."customFields", OLD."trustCategory", OLD."partnerOwnerProfileId")
      IS NOT DISTINCT FROM
      (NEW."firstName", NEW."lastName", NEW."companyName", NEW."nationalCode",
       NEW."customFields", NEW."trustCategory", NEW."partnerOwnerProfileId") THEN RETURN NEW; END IF;
  customer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF EXISTS (SELECT 1 FROM sales_contracts
      WHERE ("customerId" = customer_id OR "customerCreditCustomerId" = customer_id)
        AND "partnerCaseId" IS NULL AND "partnerKind" IS NULL) THEN
    PERFORM bump_accounting_dashboard_version('ordinary:workspace', customer_id);
  END IF;
  FOR internal_id IN
    SELECT DISTINCT "internalRecordId" FROM partner_sale_cases
      WHERE "customerId" = customer_id AND "internalRecordId" IS NOT NULL
  LOOP
    PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':workspace', customer_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER accounting_dashboard_customer_change
  AFTER INSERT OR UPDATE OR DELETE ON crm_customers
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_customer_change();

CREATE FUNCTION mark_accounting_dashboard_user_name_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
      (OLD."firstName", OLD."lastName", OLD.username) IS NOT DISTINCT FROM
      (NEW."firstName", NEW."lastName", NEW.username) THEN RETURN NEW; END IF;
  PERFORM bump_accounting_dashboard_version('ordinary:workspace',
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER accounting_dashboard_user_name_change
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_user_name_change();

CREATE TRIGGER accounting_dashboard_settings_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_settings
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
CREATE TRIGGER accounting_dashboard_period_change
  AFTER INSERT OR UPDATE OR DELETE ON accounting_periods
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_change();
