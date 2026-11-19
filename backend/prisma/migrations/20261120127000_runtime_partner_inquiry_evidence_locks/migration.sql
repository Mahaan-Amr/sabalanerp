-- Conversion disposition checks lock responder and audit evidence. Case pricing
-- checks also lock the approval joined from product and material inquiry usage.
-- PostgreSQL requires UPDATE to take these row locks. Block runtime rewrites.
DO $$
DECLARE
  runtime pg_catalog.pg_roles%ROWTYPE;
  name text;
  relation_oid oid;
  direct text[];
  owner_granted boolean;
BEGIN
  SELECT * INTO runtime FROM pg_catalog.pg_roles
    WHERE rolname = 'sabalan_application_runtime';

  IF runtime.rolcanlogin AND (runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
    OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls
    OR runtime.rolconfig IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members
      WHERE member = runtime.oid OR roleid = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_shdepend
      WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = runtime.oid AND deptype = 'o')
  ) THEN
    RAISE EXCEPTION 'RUNTIME_PARTNER_INQUIRY_EVIDENCE_ROLE_UNEXPECTED';
  END IF;

  FOREACH name IN ARRAY ARRAY[
    'partner_conversion_dispositions',
    'partner_inquiry_approvals',
    'partner_inquiry_assignments',
    'partner_profile_responder_assignments',
    'sales_contract_draft_audits',
    'sales_contract_seller_audits'
  ]
  LOOP
    relation_oid := to_regclass(format('public.%I', name));
    EXECUTE format('CREATE TRIGGER restrict_runtime_reference_update
      BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_reference_row()', name);

    IF NOT coalesce(runtime.rolcanlogin, false) THEN
      CONTINUE;
    END IF;

    SELECT coalesce(array_agg(acl.privilege_type ORDER BY acl.privilege_type), ARRAY[]::text[]),
      coalesce(bool_and(relation.relowner <> runtime.oid
        AND acl.grantee = runtime.oid AND acl.grantor = relation.relowner AND NOT acl.is_grantable), false)
      INTO direct, owner_granted
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
      WHERE relation.oid = relation_oid AND acl.grantee IN (0, runtime.oid);
    IF NOT owner_granted OR (direct <> ARRAY['INSERT', 'SELECT'] AND direct <> ARRAY['INSERT', 'SELECT', 'UPDATE'])
      OR EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid = relation_oid AND attacl IS NOT NULL)
    THEN
      RAISE EXCEPTION 'RUNTIME_PARTNER_INQUIRY_EVIDENCE_ACL_UNEXPECTED: %', name;
    END IF;

    EXECUTE format('GRANT UPDATE ON TABLE public.%I TO sabalan_application_runtime', name);
  END LOOP;
END $$;
