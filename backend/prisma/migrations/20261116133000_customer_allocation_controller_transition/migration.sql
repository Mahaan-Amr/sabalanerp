-- This role has no password at migration time. A separate protected credential
-- must be provisioned before the dormant controller can connect.
DO $$
DECLARE existing pg_authid%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM pg_authid WHERE rolname = 'sabalan_allocation_controller';
  IF NOT FOUND THEN
    CREATE ROLE sabalan_allocation_controller
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  ELSIF existing.rolsuper OR existing.rolcreatedb OR existing.rolcreaterole OR
    existing.rolinherit OR existing.rolcanlogin OR existing.rolreplication OR
    existing.rolbypassrls OR existing.rolpassword IS NOT NULL OR
    EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = existing.oid OR member = existing.oid) THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROLLER_ROLE_UNSAFE';
  END IF;
END $$;

DROP TRIGGER keep_customer_allocation_control_closed ON public.customer_allocation_release_control;
DROP FUNCTION public.keep_customer_allocation_control_closed();
ALTER TABLE public.customer_allocation_release_control DROP CONSTRAINT customer_allocation_release_control_state_check;
ALTER TABLE public.customer_allocation_release_control
  ADD CONSTRAINT customer_allocation_release_control_state_check CHECK (state IN ('CLOSED', 'ACTIVE')),
  ADD COLUMN deployment_id text,
  ADD COLUMN release_id text,
  ADD COLUMN manifest_sha256 text,
  ADD COLUMN activated_at timestamptz,
  ADD CONSTRAINT customer_allocation_active_receipt CHECK (
    (state = 'CLOSED' AND deployment_id IS NULL AND release_id IS NULL AND manifest_sha256 IS NULL AND activated_at IS NULL)
    OR (state = 'ACTIVE' AND deployment_id IS NOT NULL AND release_id IS NOT NULL
      AND manifest_sha256 ~ '^[0-9a-f]{64}$' AND activated_at IS NOT NULL));

CREATE TABLE public.customer_allocation_release_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deployment_id text NOT NULL,
  release_id text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  event text NOT NULL CHECK (event = 'ACTIVATED'),
  recorded_at timestamptz NOT NULL
);

CREATE FUNCTION public.guard_customer_allocation_control() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' OR TG_OP = 'INSERT' OR
    session_user <> 'sabalan_allocation_controller' OR
    OLD.id <> 'grouped-allocation' OR OLD.state <> 'CLOSED' OR NEW.state <> 'ACTIVE' OR
    NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROL_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_customer_allocation_control_row
  BEFORE INSERT OR UPDATE OR DELETE ON public.customer_allocation_release_control
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_allocation_control();
CREATE TRIGGER guard_customer_allocation_control_truncate
  BEFORE TRUNCATE ON public.customer_allocation_release_control
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_customer_allocation_control();

CREATE FUNCTION public.guard_customer_allocation_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN RAISE EXCEPTION 'CUSTOMER_ALLOCATION_AUDIT_IMMUTABLE'; END $$;
CREATE TRIGGER guard_customer_allocation_audit
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.customer_allocation_release_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_customer_allocation_audit();

CREATE FUNCTION public.customer_allocation_controller_lock(p_deployment_id text, p_lease_token text)
RETURNS TABLE (deployment_id text, "activeKey" text, phase text, "leaseToken" text,
  "leaseExpiresAt" timestamptz, "targetCommit" text, "releaseId" text,
  "dbClock" timestamptz, "controlState" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE operation public.deployment_operations%ROWTYPE;
BEGIN
  IF session_user <> 'sabalan_allocation_controller' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROLLER_ROLE_REQUIRED';
  END IF;
  SELECT * INTO operation FROM public.deployment_operations AS d
    WHERE d.id = p_deployment_id AND d."leaseToken" = p_lease_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ALLOCATION_DEPLOYMENT_NOT_OWNED'; END IF;
  deployment_id := operation.id;
  "activeKey" := operation."activeKey";
  phase := operation.phase;
  "leaseToken" := operation."leaseToken";
  "leaseExpiresAt" := operation."leaseExpiresAt";
  "targetCommit" := operation."targetCommit";
  "releaseId" := operation."releaseId";
  "dbClock" := clock_timestamp();
  SELECT c.state INTO "controlState" FROM public.customer_allocation_release_control AS c
    WHERE c.id = 'grouped-allocation' FOR UPDATE;
  RETURN NEXT;
END $$;

CREATE FUNCTION public.customer_allocation_controller_activate(
  p_deployment_id text, p_lease_token text, p_release_id text,
  p_manifest_sha256 text, p_expires_at timestamptz)
RETURNS TABLE (state text, manifest_sha256 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE operation public.deployment_operations%ROWTYPE; sampled_at timestamptz;
BEGIN
  IF session_user <> 'sabalan_allocation_controller' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROLLER_ROLE_REQUIRED';
  END IF;
  SELECT * INTO operation FROM public.deployment_operations AS d
    WHERE d.id = p_deployment_id AND d."leaseToken" = p_lease_token FOR UPDATE;
  sampled_at := clock_timestamp();
  IF NOT FOUND OR operation."activeKey" IS DISTINCT FROM 'production' OR
    operation.phase IS DISTINCT FROM 'MIGRATIONS_APPLIED' OR
    operation."releaseId" IS DISTINCT FROM p_release_id OR
    operation."leaseExpiresAt" <= sampled_at + interval '20 seconds' OR
    p_expires_at <= sampled_at OR p_manifest_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROLLER_BOUNDARY_REJECTED';
  END IF;
  UPDATE public.customer_allocation_release_control AS c SET state = 'ACTIVE',
    deployment_id = p_deployment_id, release_id = p_release_id,
    manifest_sha256 = p_manifest_sha256, activated_at = sampled_at
    WHERE c.id = 'grouped-allocation' AND c.state = 'CLOSED';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROL_REPLAY'; END IF;
  INSERT INTO public.customer_allocation_release_audit
    (deployment_id, release_id, manifest_sha256, event, recorded_at)
    VALUES (p_deployment_id, p_release_id, p_manifest_sha256, 'ACTIVATED', sampled_at);
  state := 'ACTIVE'; manifest_sha256 := p_manifest_sha256; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.customer_allocation_controller_lock(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_allocation_controller_activate(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_allocation_controller_lock(text, text) TO sabalan_allocation_controller;
GRANT EXECUTE ON FUNCTION public.customer_allocation_controller_activate(text, text, text, text, timestamptz) TO sabalan_allocation_controller;
REVOKE ALL ON public.customer_allocation_release_control, public.customer_allocation_release_audit FROM sabalan_allocation_controller;
