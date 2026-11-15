-- Partner authority and financial preparation can change without an invoice
-- mutation. Keep each affected internal Case's private dashboard token current.
CREATE FUNCTION mark_partner_accounting_dashboard_source_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_id text;
  internal_id text;
  before_id text;
  after_id text;
  changed_row_id text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    before_id := to_jsonb(OLD) ->> CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN 'id' ELSE 'caseId' END;
    changed_row_id := OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    after_id := to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN 'id' ELSE 'caseId' END;
    changed_row_id := NEW.id;
  END IF;
  FOR source_id IN
    SELECT DISTINCT key FROM unnest(ARRAY[before_id, after_id]) AS key WHERE key IS NOT NULL
  LOOP
    FOR internal_id IN
      SELECT "internalRecordId" FROM partner_sale_cases
      WHERE "internalRecordId" IS NOT NULL
        AND (CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN "profileId" ELSE id END) = source_id
    LOOP
      PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':workspace',
        changed_row_id);
      PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':trend',
        changed_row_id);
    END LOOP;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER accounting_dashboard_partner_profile_change
  AFTER INSERT OR UPDATE OR DELETE ON partner_profiles
  FOR EACH ROW EXECUTE FUNCTION mark_partner_accounting_dashboard_source_change();
CREATE TRIGGER accounting_dashboard_partner_revision_change
  AFTER INSERT OR UPDATE OR DELETE ON partner_case_revisions
  FOR EACH ROW EXECUTE FUNCTION mark_partner_accounting_dashboard_source_change();
CREATE TRIGGER accounting_dashboard_partner_plan_change
  AFTER INSERT OR UPDATE OR DELETE ON partner_payment_plans
  FOR EACH ROW EXECUTE FUNCTION mark_partner_accounting_dashboard_source_change();
