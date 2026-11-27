CREATE TABLE public.sepidar_cheque_batch_admissions (
  manifest_sha256 text PRIMARY KEY CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  deployment_id text NOT NULL REFERENCES public.deployment_operations(id) ON DELETE RESTRICT,
  release_id text NOT NULL,
  book_id text NOT NULL REFERENCES public.accounting_books(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  plan_sha256 text NOT NULL CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  checkpoint_hash text NOT NULL CHECK (checkpoint_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  UNIQUE (deployment_id, book_id)
);

CREATE TRIGGER sepidar_cheque_batch_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.sepidar_cheque_batch_admissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();

CREATE TRIGGER sepidar_cheque_batch_no_truncate
  BEFORE TRUNCATE ON public.sepidar_cheque_batch_admissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();

CREATE FUNCTION public.sepidar_cheque_batch_register(
  p_deployment_id text, p_release_id text, p_lease_token text, p_manifest text, p_manifest_sha256 text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  deployment record;
  manifest jsonb;
  approved_expiry timestamptz;
BEGIN
  SELECT * INTO STRICT deployment FROM public.sepidar_customer_opening_lock(p_deployment_id, p_release_id, p_lease_token);
  IF p_manifest IS NULL OR octet_length(p_manifest) > 1000000
    OR p_manifest_sha256 IS DISTINCT FROM encode(public.digest(convert_to(p_manifest, 'UTF8'), 'sha256'), 'hex')
  THEN RAISE EXCEPTION 'SEPIDAR_CHEQUE_MANIFEST_HASH_MISMATCH'; END IF;
  manifest := p_manifest::jsonb;
  approved_expiry := (manifest ->> 'expiresAt')::timestamptz;
  IF manifest ->> 'format' IS DISTINCT FROM 'sepidar-opening-cheque-batch-approval-v1'
    OR manifest ->> 'decision' IS DISTINCT FROM 'GO'
    OR manifest ->> 'releaseId' IS DISTINCT FROM p_release_id
    OR manifest ->> 'deploymentId' IS DISTINCT FROM p_deployment_id
    OR manifest ->> 'checkpointHash' IS DISTINCT FROM deployment.checkpoint_hash
    OR manifest ->> 'buildCommit' IS DISTINCT FROM deployment.build_commit
    OR manifest ->> 'basisAt' IS DISTINCT FROM '2026-03-21T00:00:00.000Z'
    OR COALESCE(manifest ->> 'planSha256', '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(manifest ->> 'preparationSha256', '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(manifest ->> 'accountingApprovalSha256', '') !~ '^[0-9a-f]{64}$'
    OR approved_expiry IS NULL OR approved_expiry <= deployment.database_clock
    OR approved_expiry > deployment.database_clock + interval '7 days'
  THEN RAISE EXCEPTION 'SEPIDAR_CHEQUE_MANIFEST_INVALID'; END IF;

  INSERT INTO public.sepidar_cheque_batch_admissions (
    manifest_sha256, deployment_id, release_id, book_id, actor_id, plan_sha256, checkpoint_hash, expires_at
  ) VALUES (
    p_manifest_sha256, p_deployment_id, p_release_id, manifest ->> 'bookId', manifest ->> 'actorId',
    manifest ->> 'planSha256', deployment.checkpoint_hash, approved_expiry
  ) ON CONFLICT (manifest_sha256) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.sepidar_opening_cheques_runtime_admitted(
  p_release_id text, p_book_id text, p_actor_id text, p_plan_sha256 text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session_user = 'sabalan_application_runtime'
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles runtime
      WHERE runtime.rolname = session_user
        AND NOT (runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
          OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members member WHERE member.roleid = runtime.oid OR member.member = runtime.oid)
    )
    AND EXISTS (
      SELECT 1 FROM public.sepidar_cheque_batch_admissions approval
      JOIN public.deployment_operations operation ON operation.id = approval.deployment_id
      WHERE approval.release_id = p_release_id AND approval.book_id = p_book_id
        AND approval.actor_id = p_actor_id AND approval.plan_sha256 = p_plan_sha256
        AND approval.expires_at > clock_timestamp()
        AND operation."releaseId" = p_release_id AND operation.phase = 'COMPLETED' AND operation."activeKey" IS NULL
        AND operation."checkpointJson" ->> 'deploymentId' = operation.id
        AND operation."checkpointJson" ->> 'releaseId' = p_release_id
        AND operation."checkpointJson" -> 'localVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'remoteVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'restoreVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'manifestReadable' = 'true'::jsonb
        AND operation."checkpointJson" ->> 'checksum' = approval.checkpoint_hash
        AND NOT EXISTS (
          SELECT 1 FROM public.deployment_operations other
          WHERE other."activeKey" = 'production'
            OR (other.phase = 'COMPLETED' AND other.id <> operation.id AND other."startedAt" >= operation."startedAt")
        )
    )
$$;

REVOKE ALL ON public.sepidar_cheque_batch_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sepidar_cheque_batch_register(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sepidar_cheque_batch_register(text,text,text,text,text) TO sabalan_sepidar_opening_controller;
REVOKE ALL ON FUNCTION public.sepidar_opening_cheques_runtime_admitted(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sepidar_opening_cheques_runtime_admitted(text,text,text,text) TO sabalan_application_runtime;
