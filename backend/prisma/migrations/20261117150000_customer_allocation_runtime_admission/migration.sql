CREATE FUNCTION public.customer_allocation_runtime_admitted(p_commit text, p_release_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE control public.customer_allocation_release_control%ROWTYPE;
BEGIN
  IF session_user <> 'sabalan_application_runtime' OR p_commit IS NULL OR p_commit !~ '^[0-9a-f]{40}$'
    OR p_release_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_roles AS runtime WHERE runtime.rolname = session_user
        AND NOT (runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
          OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members AS member WHERE member.roleid = runtime.oid OR member.member = runtime.oid)
    ) THEN
    RETURN false;
  END IF;
  SELECT * INTO control FROM public.customer_allocation_release_control
    WHERE id = 'grouped-allocation' FOR SHARE;
  IF control.state IS DISTINCT FROM 'ACTIVE' OR control.release_id IS DISTINCT FROM p_release_id THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.deployment_operations AS operation
    JOIN public.customer_allocation_release_audit AS audit
      ON audit.deployment_id = operation.id AND audit.release_id = operation."releaseId"
      AND audit.event = 'ACTIVATED' AND audit.manifest_sha256 = control.manifest_sha256
    WHERE operation.id = control.deployment_id AND operation."releaseId" = p_release_id
      AND operation."targetCommit" = p_commit AND operation.phase IN ('TRAFFIC_OPENED', 'COMPLETED')
  );
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    CREATE ROLE sabalan_application_runtime
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;


REVOKE ALL ON FUNCTION public.customer_allocation_runtime_admitted(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_allocation_runtime_admitted(text, text) TO sabalan_application_runtime;

CREATE OR REPLACE FUNCTION public.require_active_grouped_allocation_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE active_commit text;
DECLARE active_release text;
BEGIN
  IF NEW."parentCommandKey" IS NULL THEN RETURN NULL; END IF;
  SELECT operation."targetCommit", control.release_id INTO active_commit, active_release
    FROM public.customer_allocation_release_control AS control
    JOIN public.deployment_operations AS operation ON operation.id = control.deployment_id
    WHERE control.id = 'grouped-allocation';
  IF NOT public.customer_allocation_runtime_admitted(active_commit, active_release) THEN
    RAISE EXCEPTION 'CUSTOMER_SOURCE_SHARES_CLOSED';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.require_active_grouped_allocation_child() FROM PUBLIC;
