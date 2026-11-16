-- Control-only preparation. Run with psql -v ON_ERROR_STOP=1 against an isolated
-- restored database. No login, password, ownership, membership, or grants.
BEGIN;
SELECT pg_advisory_xact_lock(456, 1);
DO $$
DECLARE existing pg_authid%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    CREATE ROLE sabalan_application_runtime
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  END IF;
  SELECT * INTO STRICT existing FROM pg_authid WHERE rolname = 'sabalan_application_runtime';
  IF existing.rolsuper OR existing.rolcreatedb OR existing.rolcreaterole OR
    existing.rolinherit OR existing.rolcanlogin OR existing.rolreplication OR
    existing.rolbypassrls OR existing.rolpassword IS NOT NULL OR
    EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = existing.oid OR member = existing.oid) OR
    EXISTS (SELECT 1 FROM pg_database WHERE datdba = existing.oid) OR
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = existing.oid) OR
    EXISTS (SELECT 1 FROM pg_class WHERE relowner = existing.oid) OR
    EXISTS (SELECT 1 FROM pg_proc WHERE proowner = existing.oid) THEN
    RAISE EXCEPTION 'APPLICATION_RUNTIME_ROLE_UNSAFE';
  END IF;
END $$;
COMMIT;
