-- HR records new assignments and closes existing periods. PostgreSQL also
-- requires relation UPDATE for the row locks used to serialize these operations.
DO $assignments$
DECLARE
  runtime pg_catalog.pg_roles%ROWTYPE;
  relation_name text;
  relation_oid oid;
  table_owner oid;
  direct_grants text[];
  grants_from_owner boolean;
BEGIN
  SELECT * INTO runtime FROM pg_catalog.pg_roles WHERE rolname = 'sabalan_application_runtime';
  IF runtime.rolcanlogin AND (
    runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
    OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls
    OR runtime.rolconfig IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = runtime.oid OR roleid = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_shdepend
      WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = runtime.oid AND deptype = 'o')
  ) THEN
    RAISE EXCEPTION 'RUNTIME_DRIVER_ASSIGNMENT_ROLE_UNEXPECTED';
  END IF;

  CREATE FUNCTION public.protect_runtime_driver_assignment_identity() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fence$
  BEGIN
    IF current_user = 'sabalan_application_runtime'
      AND (to_jsonb(NEW) - 'effectiveTo') IS DISTINCT FROM (to_jsonb(OLD) - 'effectiveTo') THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Restricted runtime may update only the end of a driver assignment';
    END IF;
    RETURN NEW;
  END;
  $fence$;

  FOREACH relation_name IN ARRAY ARRAY['driver_vehicle_assignments', 'external_driver_vehicle_assignments']
  LOOP
    SELECT oid, relowner INTO relation_oid, table_owner FROM pg_catalog.pg_class
      WHERE oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', relation_name)) AND relkind = 'r';
    IF relation_oid IS NULL OR pg_catalog.pg_get_userbyid(table_owner) <> current_user THEN
      RAISE EXCEPTION 'RUNTIME_DRIVER_ASSIGNMENT_RELATION_UNEXPECTED: %', relation_name;
    END IF;

    EXECUTE pg_catalog.format('CREATE TRIGGER restrict_runtime_driver_assignment_update
      BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_driver_assignment_identity()',
      relation_name);

    -- A dormant or absent role receives its privileges only at the protected split.
    IF runtime.rolcanlogin THEN
      SELECT pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type),
        pg_catalog.bool_and(acl.grantor = table_owner AND NOT acl.is_grantable)
        INTO direct_grants, grants_from_owner
        FROM pg_catalog.pg_class AS relation
        CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
        WHERE relation.oid = relation_oid AND acl.grantee = runtime.oid;
      IF grants_from_owner IS DISTINCT FROM true
        OR direct_grants NOT IN (ARRAY['SELECT'], ARRAY['INSERT', 'SELECT', 'UPDATE'])
        OR EXISTS (
          SELECT FROM pg_catalog.pg_class AS relation
          CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
          WHERE relation.oid = relation_oid AND acl.grantee = 0
        ) OR EXISTS (
          SELECT FROM pg_catalog.pg_attribute AS column_info
          CROSS JOIN LATERAL pg_catalog.aclexplode(column_info.attacl) AS acl
          WHERE column_info.attrelid = relation_oid AND acl.grantee IN (0, runtime.oid)
        ) THEN
        RAISE EXCEPTION 'RUNTIME_DRIVER_ASSIGNMENT_ACL_UNEXPECTED: %', relation_name;
      END IF;

      EXECUTE pg_catalog.format('GRANT INSERT, UPDATE ON TABLE public.%I TO sabalan_application_runtime', relation_name);
    END IF;
  END LOOP;
END;
$assignments$;
