-- PostgreSQL row locks require relation UPDATE. Keep these reference rows
-- read-only to the application while preserving its existing lock strengths.
CREATE FUNCTION public.protect_runtime_reference_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user = 'sabalan_application_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Restricted runtime may lock this reference but may not update it';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  runtime pg_catalog.pg_roles%ROWTYPE;
  item record;
  table_oid oid;
  expected text[];
  direct text[];
  owned boolean;
BEGIN
  SELECT * INTO runtime FROM pg_catalog.pg_roles
    WHERE rolname = 'sabalan_application_runtime';

  IF runtime.rolcanlogin AND (
    runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
    OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls
    OR runtime.rolconfig IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members
      WHERE member = runtime.oid OR roleid = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = runtime.oid)
  ) THEN
    RAISE EXCEPTION 'RUNTIME_REFERENCE_ROW_LOCK_ROLE_UNEXPECTED';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('external_driver_documents', true),
    ('external_vehicle_documents', true),
    ('partner_commercial_accounts', true),
    ('partner_commercial_numbers', false),
    ('partner_duplicate_customer_matches', true),
    ('partner_identity_evidence', false),
    ('partner_terms_policies', false),
    ('simple_performance_profiles', true)
  ) AS relations(name, inserts)
  LOOP
    table_oid := to_regclass(format('public.%I', item.name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'RUNTIME_REFERENCE_ROW_LOCK_RELATION_MISSING: %', item.name;
    END IF;

    EXECUTE format('CREATE TRIGGER restrict_runtime_reference_update
      BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_reference_row()', item.name);

    IF runtime.rolcanlogin THEN
      expected := CASE WHEN item.inserts THEN ARRAY['INSERT', 'SELECT'] ELSE ARRAY['SELECT'] END;
      SELECT coalesce(array_agg(acl.privilege_type ORDER BY acl.privilege_type), ARRAY[]::text[]),
        coalesce(bool_and(relation.relowner <> runtime.oid
          AND acl.grantor = relation.relowner AND NOT acl.is_grantable), false)
        INTO direct, owned
        FROM pg_catalog.pg_class AS relation
        CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
        WHERE relation.oid = table_oid AND acl.grantee = runtime.oid;
      IF NOT owned OR (direct <> expected AND direct <> array_append(expected, 'UPDATE')) THEN
        RAISE EXCEPTION 'RUNTIME_REFERENCE_ROW_LOCK_ACL_UNEXPECTED: %', item.name;
      END IF;

      EXECUTE format('GRANT UPDATE ON TABLE public.%I TO sabalan_application_runtime', item.name);
    END IF;
  END LOOP;
END $$;
