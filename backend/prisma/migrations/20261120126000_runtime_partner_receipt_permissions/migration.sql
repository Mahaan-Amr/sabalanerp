-- The runtime may lock immutable payment evidence and assemble receipt allocations
-- during the transaction that creates the receipt.
CREATE FUNCTION public.protect_runtime_partner_receipt_assembly() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF current_user = 'sabalan_application_runtime' AND NOT EXISTS (
    SELECT FROM public.partner_retail_receipts AS receipt
    WHERE receipt.id = NEW."receiptId" AND receipt."planId" = NEW."planId"
      AND receipt.xmin::text = pg_current_xact_id()::text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Receipt allocations must be assembled in the receipt transaction';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER restrict_runtime_receipt_assembly
  BEFORE INSERT ON public.partner_retail_receipt_allocations
  FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_partner_receipt_assembly();

DO $$
DECLARE
  runtime pg_catalog.pg_roles%ROWTYPE;
  item record;
  relation_oid oid;
  previous text[];
  required text[] := ARRAY['INSERT', 'SELECT', 'UPDATE'];
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
    RAISE EXCEPTION 'RUNTIME_PARTNER_RECEIPT_ROLE_UNEXPECTED';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('partner_case_events', true),
    ('partner_payment_installments', true),
    ('partner_payment_plans', true),
    ('partner_retail_receipt_allocations', false),
    ('partner_retail_receipts', true)
  ) AS relations(name, already_inserts)
  LOOP
    relation_oid := to_regclass(format('public.%I', item.name));
    EXECUTE format('CREATE TRIGGER restrict_runtime_reference_update
      BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_reference_row()', item.name);

    IF NOT coalesce(runtime.rolcanlogin, false) THEN
      CONTINUE;
    END IF;

    previous := CASE WHEN item.already_inserts
      THEN ARRAY['INSERT', 'SELECT'] ELSE ARRAY['SELECT'] END;
    SELECT coalesce(array_agg(acl.privilege_type ORDER BY acl.privilege_type), ARRAY[]::text[]),
      coalesce(bool_and(relation.relowner <> runtime.oid
        AND acl.grantee = runtime.oid AND acl.grantor = relation.relowner AND NOT acl.is_grantable), false)
      INTO direct, owner_granted
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
      WHERE relation.oid = relation_oid AND acl.grantee IN (0, runtime.oid);
    IF NOT owner_granted OR (direct <> previous AND direct <> required)
      OR EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid = relation_oid AND attacl IS NOT NULL)
    THEN
      RAISE EXCEPTION 'RUNTIME_PARTNER_RECEIPT_ACL_UNEXPECTED: %', item.name;
    END IF;

    IF NOT item.already_inserts THEN
      EXECUTE format('GRANT INSERT ON TABLE public.%I TO sabalan_application_runtime', item.name);
    END IF;
    EXECUTE format('GRANT UPDATE ON TABLE public.%I TO sabalan_application_runtime', item.name);
  END LOOP;
END $$;
