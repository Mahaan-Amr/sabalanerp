-- The invoker trigger creates a card when the runtime creates a Customer.
-- An absent or dormant runtime is handled by the protected role split later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'sabalan_application_runtime' AND rolcanlogin
  ) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS runtime
    JOIN pg_catalog.pg_class AS cards ON cards.oid = 'public.crm_customer_cards'::pg_catalog.regclass
    WHERE runtime.rolname = 'sabalan_application_runtime'
      AND runtime.rolcanlogin AND cards.relowner <> runtime.oid AND runtime.rolconfig IS NULL
      AND NOT (runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
        OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls)
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members AS member
        WHERE member.roleid = runtime.oid OR member.member = runtime.oid
      )
      AND (
        SELECT array_agg(grant_entry.privilege_type ORDER BY grant_entry.privilege_type)
        FROM pg_catalog.aclexplode(cards.relacl) AS grant_entry
        WHERE grant_entry.grantee = runtime.oid
        HAVING bool_and(grant_entry.grantor = cards.relowner AND NOT grant_entry.is_grantable)
      ) IN (ARRAY['DELETE', 'SELECT'], ARRAY['DELETE', 'INSERT', 'SELECT'])
  ) THEN
    RAISE EXCEPTION 'CRM_CUSTOMER_CARD_RUNTIME_ACL_UNEXPECTED';
  END IF;
  GRANT INSERT ON TABLE public.crm_customer_cards TO sabalan_application_runtime;
END $$;
