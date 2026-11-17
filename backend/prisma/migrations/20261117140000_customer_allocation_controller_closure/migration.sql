ALTER TABLE public.customer_allocation_release_audit
  DROP CONSTRAINT customer_allocation_release_audit_event_check,
  ADD CONSTRAINT customer_allocation_release_audit_event_check CHECK (event IN ('ACTIVATED', 'CLOSED'));

CREATE UNIQUE INDEX customer_allocation_release_audit_activation_once
  ON public.customer_allocation_release_audit (deployment_id, release_id)
  WHERE event = 'ACTIVATED';

CREATE OR REPLACE FUNCTION public.guard_customer_allocation_control() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR session_user <> 'sabalan_allocation_controller' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROL_IMMUTABLE';
  END IF;
  IF OLD.id <> 'grouped-allocation' OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR
    NOT ((OLD.state = 'CLOSED' AND NEW.state = 'ACTIVE') OR (OLD.state = 'ACTIVE' AND NEW.state = 'CLOSED')) THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROL_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.customer_allocation_controller_close(
  p_deployment_id text, p_lease_token text, p_release_id text, p_active_manifest_sha256 text)
RETURNS TABLE (state text, manifest_sha256 text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE operation public.deployment_operations%ROWTYPE;
DECLARE activated public.customer_allocation_release_control%ROWTYPE;
DECLARE sampled_at timestamptz;
BEGIN
  IF session_user <> 'sabalan_allocation_controller' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CONTROLLER_ROLE_REQUIRED';
  END IF;
  SELECT * INTO operation FROM public.deployment_operations AS d
    WHERE d.id = p_deployment_id AND d."leaseToken" = p_lease_token FOR UPDATE;
  IF NOT FOUND OR operation."activeKey" IS DISTINCT FROM 'production'
    OR operation.phase NOT IN ('MUTATION_STARTED', 'ROLLBACK_STARTED')
    OR operation."releaseId" IS DISTINCT FROM p_release_id
    OR operation."checkpointJson" ->> 'deploymentId' IS DISTINCT FROM operation.id
    OR operation."checkpointJson" ->> 'releaseId' IS DISTINCT FROM operation."releaseId"
    OR operation."checkpointJson" -> 'localVerified' IS DISTINCT FROM 'true'::jsonb
    OR operation."checkpointJson" -> 'remoteVerified' IS DISTINCT FROM 'true'::jsonb
    OR operation."checkpointJson" -> 'restoreVerified' IS DISTINCT FROM 'true'::jsonb
    OR COALESCE(operation."checkpointJson" ->> 'checksum', '') !~ '^[0-9a-f]{64}$'
    OR operation."checkpointJson" -> 'manifestReadable' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CLOSURE_BOUNDARY_REJECTED';
  END IF;
  SELECT * INTO activated FROM public.customer_allocation_release_control AS c
    WHERE c.id = 'grouped-allocation' FOR UPDATE;
  sampled_at := clock_timestamp();
  IF operation."leaseExpiresAt" <= sampled_at + interval '20 seconds' THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CLOSURE_BOUNDARY_REJECTED';
  END IF;
  IF activated.state = 'CLOSED' AND EXISTS (
    SELECT 1 FROM public.customer_allocation_release_audit AS audit
    WHERE audit.event = 'CLOSED' AND audit.deployment_id = operation.id
      AND audit.release_id = operation."releaseId" AND audit.manifest_sha256 = p_active_manifest_sha256
  ) THEN
    state := 'CLOSED'; manifest_sha256 := p_active_manifest_sha256; RETURN NEXT; RETURN;
  END IF;
  IF activated.state IS DISTINCT FROM 'ACTIVE' OR p_active_manifest_sha256 IS NULL
    OR activated.manifest_sha256 IS DISTINCT FROM p_active_manifest_sha256 THEN
    RAISE EXCEPTION 'CUSTOMER_ALLOCATION_CLOSURE_RECEIPT_MISMATCH';
  END IF;
  UPDATE public.customer_allocation_release_control AS c
    SET state = 'CLOSED', deployment_id = NULL, release_id = NULL, manifest_sha256 = NULL, activated_at = NULL
    WHERE c.id = activated.id;
  INSERT INTO public.customer_allocation_release_audit
    (deployment_id, release_id, manifest_sha256, event, recorded_at)
    VALUES (operation.id, operation."releaseId", activated.manifest_sha256, 'CLOSED', sampled_at);
  state := 'CLOSED'; manifest_sha256 := activated.manifest_sha256; RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.customer_allocation_controller_close(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_allocation_controller_close(text, text, text, text) TO sabalan_allocation_controller;
