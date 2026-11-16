-- Read-only catalog audit. Run with psql -v ON_ERROR_STOP=1 after restore and
-- after the control-only preparation. The role intentionally has no grants yet.
-- This fails until a reviewed per-object grant manifest and direct-login tests exist.
BEGIN READ ONLY;
DO $$
DECLARE r pg_authid%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_authid WHERE rolname = 'sabalan_application_runtime';
  IF NOT FOUND OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR
    r.rolinherit OR r.rolcanlogin OR r.rolreplication OR r.rolbypassrls OR
    r.rolpassword IS NOT NULL OR
    EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = r.oid OR member = r.oid) OR
    EXISTS (SELECT 1 FROM pg_database WHERE datdba = r.oid) OR
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = r.oid) OR
    EXISTS (SELECT 1 FROM pg_class WHERE relowner = r.oid) OR
    EXISTS (SELECT 1 FROM pg_proc WHERE proowner = r.oid) THEN
    RAISE EXCEPTION 'APPLICATION_RUNTIME_ROLE_UNSAFE';
  END IF;
END $$;

SELECT jsonb_build_object(
  'database', current_database(),
  'role', 'sabalan_application_runtime',
  'can_connect', has_database_privilege('sabalan_application_runtime', current_database(), 'CONNECT'),
  'can_create_database_objects', has_database_privilege('sabalan_application_runtime', current_database(), 'CREATE'),
  'can_create_public_objects', has_schema_privilege('sabalan_application_runtime', 'public', 'CREATE'),
  'can_use_public', has_schema_privilege('sabalan_application_runtime', 'public', 'USAGE'),
  'direct_login_qualifiable', false,
  'business_grants_reviewed', false
) AS role_boundary;

-- Every present relation is named. A new protected object cannot silently
-- inherit an "all tables" grant from this preparation.
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind,
  has_table_privilege('sabalan_application_runtime', c.oid, 'SELECT') AS can_select,
  has_table_privilege('sabalan_application_runtime', c.oid, 'INSERT') AS can_insert,
  has_table_privilege('sabalan_application_runtime', c.oid, 'UPDATE') AS can_update,
  has_table_privilege('sabalan_application_runtime', c.oid, 'DELETE') AS can_delete,
  has_table_privilege('sabalan_application_runtime', c.oid, 'TRUNCATE') AS can_truncate
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
ORDER BY n.nspname, c.relname;

SELECT n.nspname AS schema_name, c.relname AS sequence_name,
  has_sequence_privilege('sabalan_application_runtime', c.oid, 'USAGE') AS can_use,
  has_sequence_privilege('sabalan_application_runtime', c.oid, 'SELECT') AS can_select,
  has_sequence_privilege('sabalan_application_runtime', c.oid, 'UPDATE') AS can_update
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY n.nspname, c.relname;

SELECT n.nspname AS schema_name, p.oid::regprocedure::text AS function_signature,
  p.prosecdef AS security_definer,
  has_function_privilege('sabalan_application_runtime', p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY n.nspname, function_signature;

-- These are hard denials even before the business manifest exists.
DO $$
BEGIN
  IF has_database_privilege('sabalan_application_runtime', current_database(), 'CREATE') OR
    has_schema_privilege('sabalan_application_runtime', 'public', 'CREATE') OR
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND
        (has_table_privilege('sabalan_application_runtime', c.oid, 'SELECT') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'INSERT') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'UPDATE') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'DELETE') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'TRUNCATE'))) OR
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S' AND
        (has_sequence_privilege('sabalan_application_runtime', c.oid, 'USAGE') OR
         has_sequence_privilege('sabalan_application_runtime', c.oid, 'SELECT') OR
         has_sequence_privilege('sabalan_application_runtime', c.oid, 'UPDATE'))) OR
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND
        has_function_privilege('sabalan_application_runtime', p.oid, 'EXECUTE')) OR
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN
        ('_prisma_migrations', 'deployment_operations', 'customer_allocation_release_control',
         'customer_allocation_release_audit') AND
        (has_table_privilege('sabalan_application_runtime', c.oid, 'SELECT') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'INSERT') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'UPDATE') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'DELETE') OR
         has_table_privilege('sabalan_application_runtime', c.oid, 'TRUNCATE'))) OR
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN
        ('customer_allocation_controller_lock', 'customer_allocation_controller_activate') AND
        has_function_privilege('sabalan_application_runtime', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'APPLICATION_RUNTIME_PROTECTED_PRIVILEGE';
  END IF;
END $$;

-- A database restored with --no-owner --no-privileges needs fresh, reviewed
-- per-object grants. This precursor deliberately cannot pass admission.
DO $$ BEGIN RAISE EXCEPTION 'APPLICATION_RUNTIME_GRANT_MANIFEST_NOT_REVIEWED'; END $$;
ROLLBACK;
