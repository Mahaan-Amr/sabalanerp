-- Scope this conservative name signal to Accounting evidence authored by the
-- user. A Partner-only owner must not advance the shared ordinary token.
DROP TRIGGER accounting_dashboard_user_name_change ON users;

CREATE OR REPLACE FUNCTION mark_accounting_dashboard_user_name_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  subject_id text;
  internal_id text;
  ordinary_used boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND
      (OLD."firstName", OLD."lastName", OLD.username) IS NOT DISTINCT FROM
      (NEW."firstName", NEW."lastName", NEW.username) THEN RETURN NEW; END IF;
  subject_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  SELECT EXISTS (
    SELECT 1 FROM accounting_receivables AS r
      WHERE r."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_receivables', to_jsonb(r)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_payment_statuses AS p
      WHERE p."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_payment_statuses', to_jsonb(p)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_financial_records AS f
      WHERE f."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_financial_records', to_jsonb(f)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_tax_records AS t
      WHERE t."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_tax_records', to_jsonb(t)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_correction_requests AS c
      WHERE c."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_correction_requests', to_jsonb(c)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_contract_flags AS f
      WHERE f."createdBy" = subject_id
        AND accounting_dashboard_row_scope('accounting_contract_flags', to_jsonb(f)) = 'ordinary'
    UNION ALL SELECT 1 FROM accounting_audit_logs AS a
      WHERE a."actorId" = subject_id
        AND accounting_dashboard_row_scope('accounting_audit_logs', to_jsonb(a)) = 'ordinary'
  ) INTO ordinary_used;
  IF ordinary_used THEN
    PERFORM bump_accounting_dashboard_version('ordinary:workspace', subject_id);
  END IF;
  FOR internal_id IN
    SELECT DISTINCT c."internalRecordId" FROM partner_sale_cases AS c
      JOIN partner_profiles AS profile ON profile.id = c."profileId"
      WHERE profile."userId" = subject_id AND c."internalRecordId" IS NOT NULL
  LOOP
    PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':workspace', subject_id);
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER accounting_dashboard_user_name_change
  BEFORE INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION mark_accounting_dashboard_user_name_change();
