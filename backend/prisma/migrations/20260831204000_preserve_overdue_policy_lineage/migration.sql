CREATE OR REPLACE FUNCTION performance_require_overdue_policy_replacement()
RETURNS trigger AS $$
DECLARE
  replacement_exists BOOLEAN := FALSE;
BEGIN
  IF OLD."lifecycle"::TEXT = 'SCHEDULED' AND NEW."lifecycle"::TEXT = 'RETIRED' THEN
    IF TG_TABLE_NAME <> 'performance_policy_versions' THEN
      RAISE EXCEPTION 'only an overdue policy with a replacement can retire from scheduled state';
    END IF;
    IF OLD."effectiveFrom" > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'a policy cannot be superseded before its effective time';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM "performance_policy_versions"
      WHERE "policyKind" = OLD."policyKind"
        AND "version" > OLD."version"
        AND "contentHash" = OLD."contentHash"
        AND "lifecycle" = 'DRAFT'
    ) INTO replacement_exists;
    IF NOT replacement_exists THEN
      RAISE EXCEPTION 'overdue policy supersession requires a draft replacement';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
