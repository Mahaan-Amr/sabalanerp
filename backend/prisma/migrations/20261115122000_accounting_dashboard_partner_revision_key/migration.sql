-- Partner Case revisions use (caseId, revision), not a single id column.
CREATE OR REPLACE FUNCTION mark_partner_accounting_dashboard_source_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_id text;
  internal_id text;
  before_id text;
  after_id text;
  changed_row_id text;
  changed_row jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    before_id := to_jsonb(OLD) ->> CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN 'id' ELSE 'caseId' END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    after_id := to_jsonb(NEW) ->> CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN 'id' ELSE 'caseId' END;
  END IF;
  changed_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  changed_row_id := COALESCE(changed_row ->> 'id',
    (changed_row ->> 'caseId') || ':' || (changed_row ->> 'revision'));
  FOR source_id IN
    SELECT DISTINCT key FROM unnest(ARRAY[before_id, after_id]) AS key WHERE key IS NOT NULL
  LOOP
    FOR internal_id IN
      SELECT "internalRecordId" FROM partner_sale_cases
      WHERE "internalRecordId" IS NOT NULL
        AND (CASE WHEN TG_TABLE_NAME = 'partner_profiles' THEN "profileId" ELSE id END) = source_id
    LOOP
      PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':workspace', changed_row_id);
      PERFORM bump_accounting_dashboard_version('partner:' || internal_id || ':trend', changed_row_id);
    END LOOP;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
