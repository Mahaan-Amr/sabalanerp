-- The ordinary loading editor recreates draft lines. A transport mode change
-- may reset their saved quantities, while finalized line data stays read-only.
CREATE FUNCTION public.protect_runtime_loading_line_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $guard$
DECLARE loading_status text;
BEGIN
  IF current_user <> 'sabalan_application_runtime' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.quantity IS DISTINCT FROM 0
    OR NEW."khatRas" IS NOT NULL OR NEW."pieceCount" IS NOT NULL
    OR NEW.plus IS DISTINCT FROM 0 OR NEW.minus IS DISTINCT FROM 0
    OR NEW."calculationSnapshot" IS NOT NULL
    OR (to_jsonb(NEW) - ARRAY['quantity', 'khatRas', 'pieceCount', 'plus', 'minus', 'calculationSnapshot', 'updatedAt'])
      IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['quantity', 'khatRas', 'pieceCount', 'plus', 'minus', 'calculationSnapshot', 'updatedAt'])
  ) THEN
    RAISE EXCEPTION 'Restricted runtime may only reset loading line quantities' USING ERRCODE = '42501';
  END IF;

  -- Lock the parent against a concurrent status change while the draft is edited.
  SELECT status::text INTO loading_status FROM public.logistics_loadings
    WHERE id = NEW."loadingId" FOR SHARE;
  IF loading_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Restricted runtime may only write draft loading lines' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER restrict_runtime_loading_line_write
  BEFORE INSERT OR UPDATE ON public.logistics_loading_lines
  FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_loading_line_write();

-- PostgreSQL requires UPDATE for SELECT FOR UPDATE. Block even no-op updates;
-- the existing append-only trigger still applies to every role and to DELETE.
CREATE TRIGGER restrict_runtime_reference_update
  BEFORE UPDATE ON public.shipment_quantity_evidence
  FOR EACH ROW EXECUTE FUNCTION public.protect_runtime_reference_row();

DO $authority$
DECLARE
  evidence CONSTANT regclass := 'public.shipment_quantity_evidence'::regclass;
  runtime pg_catalog.pg_roles%ROWTYPE;
  relation record;
  direct text[];
  valid_grantors boolean;
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_proc AS routine ON routine.oid = trigger.tgfoid
    JOIN pg_catalog.pg_class AS target ON target.oid = trigger.tgrelid
    WHERE trigger.tgrelid = evidence AND trigger.tgname = 'shipment_quantity_evidence_immutable'
      AND trigger.tgtype = 27 AND trigger.tgenabled = 'O' AND NOT trigger.tgisinternal
      AND trigger.tgnargs = 0 AND trigger.tgqual IS NULL AND trigger.tgattr::text = ''
      AND routine.oid = 'public.prevent_shipment_quantity_evidence_mutation()'::regprocedure
      AND NOT routine.prosecdef AND routine.proconfig IS NULL AND routine.proowner = target.relowner
      AND encode(sha256(convert_to(routine.prosrc, 'UTF8')), 'hex')
        = 'cbb87b80554c0884a51f0d4bb1abb146655675d09c967e0356ab8d22b58671ac'
  ) THEN
    RAISE EXCEPTION 'RUNTIME_DISPATCH_EVIDENCE_GUARD_UNEXPECTED';
  END IF;

  SELECT * INTO runtime FROM pg_catalog.pg_roles WHERE rolname = 'sabalan_application_runtime';
  IF NOT FOUND OR NOT runtime.rolcanlogin THEN
    RETURN;
  END IF;
  IF runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole OR runtime.rolinherit
    OR runtime.rolreplication OR runtime.rolbypassrls OR runtime.rolconfig IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = runtime.oid OR roleid = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_shdepend
      WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = runtime.oid AND deptype = 'o')
  THEN
    RAISE EXCEPTION 'RUNTIME_DISPATCH_ROLE_UNEXPECTED';
  END IF;

  FOR relation IN SELECT * FROM (VALUES
    ('public.logistics_loading_lines'::regclass, ARRAY['DELETE', 'SELECT']),
    (evidence, ARRAY['DELETE', 'INSERT', 'SELECT'])
  ) AS scope(oid, predecessor)
  LOOP
    SELECT array_agg(acl.privilege_type ORDER BY acl.privilege_type),
      bool_and(target.relowner <> runtime.oid AND NOT acl.is_grantable
        AND acl.grantor = target.relowner AND acl.grantee = runtime.oid)
      INTO direct, valid_grantors
      FROM pg_catalog.pg_class AS target
      CROSS JOIN LATERAL pg_catalog.aclexplode(target.relacl) AS acl
      WHERE target.oid = relation.oid AND acl.grantee IN (0, runtime.oid);
    IF valid_grantors IS DISTINCT FROM true
      OR direct NOT IN (relation.predecessor, ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      OR EXISTS (SELECT FROM pg_catalog.pg_attribute WHERE attrelid = relation.oid AND attacl IS NOT NULL)
    THEN
      RAISE EXCEPTION 'RUNTIME_DISPATCH_ACL_UNEXPECTED: %', relation.oid;
    END IF;
  END LOOP;

  GRANT INSERT, UPDATE ON public.logistics_loading_lines TO sabalan_application_runtime;
  GRANT UPDATE ON public.shipment_quantity_evidence TO sabalan_application_runtime;
END;
$authority$;
