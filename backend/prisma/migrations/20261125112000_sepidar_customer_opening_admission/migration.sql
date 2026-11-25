DO $$
DECLARE existing pg_authid%ROWTYPE;
BEGIN
  SELECT * INTO existing FROM pg_authid WHERE rolname = 'sabalan_sepidar_opening_controller';
  IF NOT FOUND THEN
    CREATE ROLE sabalan_sepidar_opening_controller
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
  ELSIF existing.rolsuper OR existing.rolcreatedb OR existing.rolcreaterole OR
    existing.rolinherit OR existing.rolcanlogin OR existing.rolreplication OR existing.rolbypassrls
    OR existing.rolpassword IS NOT NULL OR
    EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = existing.oid OR member = existing.oid) THEN
    RAISE EXCEPTION 'SEPIDAR_OPENING_CONTROLLER_ROLE_UNSAFE';
  END IF;
END $$;

CREATE TABLE public.sepidar_customer_opening_manifests (
  manifest_sha256 text PRIMARY KEY CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  deployment_id text NOT NULL REFERENCES public.deployment_operations(id) ON DELETE RESTRICT,
  release_id text NOT NULL,
  book_id text NOT NULL REFERENCES public.accounting_books(id) ON DELETE RESTRICT,
  counter_account_id text NOT NULL REFERENCES public.accounting_ledger_accounts(id) ON DELETE RESTRICT,
  source_package_hash text NOT NULL CHECK (source_package_hash ~ '^[0-9a-f]{64}$'),
  accounting_approval_hash text NOT NULL CHECK (accounting_approval_hash ~ '^[0-9a-f]{64}$'),
  checkpoint_hash text NOT NULL CHECK (checkpoint_hash ~ '^[0-9a-f]{64}$'),
  basis_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.sepidar_customer_opening_admissions (
  idempotency_key text NOT NULL CHECK (length(idempotency_key) >= 8),
  manifest_sha256 text NOT NULL REFERENCES public.sepidar_customer_opening_manifests(manifest_sha256) ON DELETE RESTRICT,
  profile_id text REFERENCES public.accounting_customer_profiles(id) ON DELETE RESTRICT,
  crm_customer_id text REFERENCES public.crm_customers(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (length(actor_id) > 0),
  source_customer_id text NOT NULL CHECK (source_customer_id ~ '^[1-9][0-9]*$'),
  source_voucher_item_id text NOT NULL CHECK (source_voucher_item_id ~ '^[1-9][0-9]*$'),
  command_hash text NOT NULL CHECK (command_hash ~ '^[0-9a-f]{64}$'),
  approved_total_rials numeric(20,0) NOT NULL,
  CHECK ((profile_id IS NULL) <> (crm_customer_id IS NULL)),
  PRIMARY KEY (manifest_sha256, idempotency_key),
  UNIQUE (manifest_sha256, profile_id),
  UNIQUE (manifest_sha256, crm_customer_id),
  UNIQUE (manifest_sha256, source_voucher_item_id)
);

CREATE FUNCTION public.protect_sepidar_customer_opening_admission() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR session_user <> 'sabalan_sepidar_opening_controller' OR current_user = session_user THEN
    RAISE EXCEPTION 'SEPIDAR_OPENING_ADMISSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sepidar_opening_manifest_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.sepidar_customer_opening_manifests
  FOR EACH ROW EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();
CREATE TRIGGER sepidar_opening_manifest_truncate
  BEFORE TRUNCATE ON public.sepidar_customer_opening_manifests
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();
CREATE TRIGGER sepidar_opening_admissions_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.sepidar_customer_opening_admissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();
CREATE TRIGGER sepidar_opening_admissions_truncate
  BEFORE TRUNCATE ON public.sepidar_customer_opening_admissions
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_sepidar_customer_opening_admission();

CREATE FUNCTION public.sepidar_customer_opening_lock(p_deployment_id text, p_release_id text, p_lease_token text)
RETURNS TABLE (build_commit text, checkpoint_hash text, phase text, active_key text, database_clock timestamptz, lease_expiry timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  operation public.deployment_operations%ROWTYPE;
  approved_at timestamptz := clock_timestamp();
BEGIN
  IF session_user <> 'sabalan_sepidar_opening_controller' THEN
    RAISE EXCEPTION 'SEPIDAR_OPENING_CONTROLLER_REQUIRED';
  END IF;
  SELECT * INTO operation FROM public.deployment_operations
    WHERE id = p_deployment_id AND "releaseId" = p_release_id AND "leaseToken" = p_lease_token FOR UPDATE;
  IF NOT FOUND OR operation."activeKey" IS DISTINCT FROM 'production'
    OR operation.phase IS DISTINCT FROM 'MIGRATIONS_APPLIED'
    OR operation."leaseExpiresAt" IS NULL
    OR operation."leaseExpiresAt" AT TIME ZONE 'UTC' <= approved_at + interval '20 seconds'
    OR operation."checkpointJson" ->> 'deploymentId' IS DISTINCT FROM p_deployment_id
    OR operation."checkpointJson" ->> 'releaseId' IS DISTINCT FROM p_release_id
    OR operation."checkpointJson" -> 'localVerified' IS DISTINCT FROM 'true'::jsonb
    OR operation."checkpointJson" -> 'remoteVerified' IS DISTINCT FROM 'true'::jsonb
    OR operation."checkpointJson" -> 'restoreVerified' IS DISTINCT FROM 'true'::jsonb
    OR operation."checkpointJson" -> 'manifestReadable' IS DISTINCT FROM 'true'::jsonb
    OR COALESCE(operation."checkpointJson" ->> 'checksum', '') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'SEPIDAR_OPENING_DEPLOYMENT_NOT_QUALIFIED'; END IF;

  RETURN QUERY SELECT operation."targetCommit", operation."checkpointJson" ->> 'checksum',
    operation.phase::text, operation."activeKey", approved_at, operation."leaseExpiresAt" AT TIME ZONE 'UTC';
END $$;

CREATE FUNCTION public.sepidar_customer_opening_register_manifest(
  p_deployment_id text, p_release_id text, p_lease_token text, p_manifest text, p_manifest_sha256 text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  deployment record;
  manifest jsonb;
  approved_book text;
  approved_account text;
  approved_basis timestamptz;
  approved_expiry timestamptz;
BEGIN
  SELECT * INTO STRICT deployment FROM public.sepidar_customer_opening_lock(p_deployment_id, p_release_id, p_lease_token);

  IF p_manifest IS NULL OR octet_length(p_manifest) > 1000000
    OR p_manifest_sha256 IS DISTINCT FROM encode(public.digest(convert_to(p_manifest, 'UTF8'), 'sha256'), 'hex')
  THEN RAISE EXCEPTION 'SEPIDAR_OPENING_MANIFEST_HASH_MISMATCH'; END IF;
  manifest := p_manifest::jsonb;
  approved_book := manifest ->> 'bookId';
  approved_account := manifest ->> 'counterAccountId';
  approved_basis := (manifest ->> 'basisAt')::timestamptz;
  approved_expiry := (manifest ->> 'expiresAt')::timestamptz;
  IF manifest ->> 'format' IS DISTINCT FROM 'sepidar-customer-opening-approval-v1'
    OR manifest ->> 'releaseId' IS DISTINCT FROM p_release_id
    OR manifest ->> 'deploymentId' IS DISTINCT FROM p_deployment_id
    OR manifest ->> 'checkpointHash' IS DISTINCT FROM deployment.checkpoint_hash
    OR manifest ->> 'buildCommit' IS DISTINCT FROM deployment.build_commit
    OR COALESCE(manifest ->> 'accountingApprovalHash', '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(manifest ->> 'sourcePackageHash', '') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(manifest -> 'commands') IS DISTINCT FROM 'array'
    OR approved_basis IS NULL OR approved_basis >= deployment.database_clock
    OR approved_expiry IS NULL OR approved_expiry <= deployment.database_clock
    OR approved_expiry > deployment.database_clock + interval '7 days'
  THEN RAISE EXCEPTION 'SEPIDAR_OPENING_MANIFEST_INVALID'; END IF;
  IF jsonb_array_length(manifest -> 'commands') NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'SEPIDAR_OPENING_MANIFEST_SCOPE_INVALID'; END IF;

  -- Registration may be retried after a lost controller response. The
  -- deployment lock serializes enrollment and the stored rows are immutable.
  IF EXISTS (
    SELECT 1 FROM public.sepidar_customer_opening_manifests existing
    WHERE existing.manifest_sha256 = p_manifest_sha256 AND existing.deployment_id = p_deployment_id
  ) THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounting_ledger_accounts account
    WHERE account.id = approved_account AND account."bookId" = approved_book
      AND account."retiredAt" IS NULL AND account.level = 'MOIN'
      AND account."statementRole" IN ('ASSET', 'LIABILITY', 'EQUITY')
      AND account."partyRequirement" = 'FORBIDDEN' AND account."financialAccountRequirement" = 'FORBIDDEN'
      AND account."effectiveFrom" <= approved_basis AT TIME ZONE 'UTC'
  ) THEN RAISE EXCEPTION 'SEPIDAR_OPENING_CLEARING_ACCOUNT_INVALID'; END IF;

  INSERT INTO public.sepidar_customer_opening_manifests (
    manifest_sha256, deployment_id, release_id, book_id, counter_account_id, source_package_hash,
    accounting_approval_hash, checkpoint_hash, basis_at, expires_at
  ) VALUES (p_manifest_sha256, p_deployment_id, p_release_id, approved_book, approved_account,
    manifest ->> 'sourcePackageHash', manifest ->> 'accountingApprovalHash', deployment.checkpoint_hash,
    approved_basis, approved_expiry);

  INSERT INTO public.sepidar_customer_opening_admissions (
    idempotency_key, manifest_sha256, profile_id, crm_customer_id, actor_id,
    source_customer_id, source_voucher_item_id, command_hash, approved_total_rials
  )
  SELECT line ->> 'idempotencyKey', p_manifest_sha256,
    CASE WHEN line ->> 'destinationKey' NOT LIKE 'customer:%' THEN line ->> 'destinationKey' END,
    CASE WHEN line ->> 'destinationKey' LIKE 'customer:%' THEN substring(line ->> 'destinationKey' FROM 10) END,
    line ->> 'actorId',
    line ->> 'sourceCustomerId', line ->> 'sourceVoucherItemId', line ->> 'commandHash',
    CASE WHEN line ->> 'totalRials' ~ '^-?(0|[1-9][0-9]{0,19})$' THEN (line ->> 'totalRials')::numeric ELSE NULL END
  FROM jsonb_array_elements(manifest -> 'commands') AS line;
END $$;

CREATE FUNCTION public.sepidar_customer_opening_runtime_admitted(
  p_commit text, p_release_id text, p_book_id text, p_profile_id text, p_actor_id text, p_basis_at timestamptz,
  p_counter_account_id text, p_command_hash text, p_source_package_hash text,
  p_source_customer_id text, p_source_voucher_item_id text, p_idempotency_key text
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT session_user = 'sabalan_application_runtime'
    AND p_commit ~ '^[0-9a-f]{40}$'
    AND EXISTS (
      SELECT 1 FROM pg_roles runtime
      WHERE runtime.rolname = session_user
        AND NOT (runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole
          OR runtime.rolinherit OR runtime.rolreplication OR runtime.rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members member WHERE member.roleid = runtime.oid OR member.member = runtime.oid)
    )
    AND EXISTS (
      SELECT 1 FROM public.sepidar_customer_opening_admissions approval
      JOIN public.sepidar_customer_opening_manifests manifest USING (manifest_sha256)
      JOIN public.deployment_operations operation ON operation.id = manifest.deployment_id
      JOIN public.accounting_customer_profiles profile ON profile.id = p_profile_id AND profile."partySourceKind" = 'CUSTOMER'
      JOIN public.accounting_books book ON book.id = manifest.book_id AND book."legalEntityId" = profile."legalEntityId"
      WHERE approval.idempotency_key = p_idempotency_key
        AND (approval.profile_id = profile.id OR approval.crm_customer_id = profile."partySourceId")
        AND approval.actor_id = p_actor_id AND approval.command_hash = p_command_hash
        AND approval.source_customer_id = p_source_customer_id AND approval.source_voucher_item_id = p_source_voucher_item_id
        AND manifest.book_id = p_book_id AND manifest.counter_account_id = p_counter_account_id
        AND manifest.basis_at = p_basis_at AND manifest.source_package_hash = p_source_package_hash
        AND manifest.expires_at > clock_timestamp() AND manifest.release_id = p_release_id
        AND operation."releaseId" = p_release_id AND operation."targetCommit" = p_commit
        AND operation.phase = 'COMPLETED' AND operation."activeKey" IS NULL
        AND operation."checkpointJson" ->> 'deploymentId' = operation.id
        AND operation."checkpointJson" ->> 'releaseId' = operation."releaseId"
        AND operation."checkpointJson" -> 'localVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'remoteVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'restoreVerified' = 'true'::jsonb
        AND operation."checkpointJson" -> 'manifestReadable' = 'true'::jsonb
        AND operation."checkpointJson" ->> 'checksum' = manifest.checkpoint_hash
        AND NOT EXISTS (
          SELECT 1 FROM public.deployment_operations other
          WHERE other."activeKey" = 'production'
            OR (other.phase = 'COMPLETED' AND other.id <> operation.id
              AND other."startedAt" >= operation."startedAt")
        )
    )
$$;

CREATE FUNCTION public.verify_sepidar_customer_opening_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  evidence jsonb;
BEGIN
  evidence := NEW.evidence -> 'sepidarAdmission';
  IF evidence IS NULL AND NEW.evidence #> '{review,sepidarEvidence}' IS NULL THEN
    RETURN NEW;
  END IF;
  IF evidence ->> 'sourcePackageHash' IS DISTINCT FROM NEW.evidence #>> '{review,sepidarEvidence,sourcePackageHash}'
    OR evidence ->> 'sourceCustomerId' IS DISTINCT FROM NEW.evidence #>> '{review,sepidarEvidence,sourceCustomerId}'
    OR evidence ->> 'sourceVoucherItemId' IS DISTINCT FROM NEW.evidence #>> '{review,sepidarEvidence,sourceVoucherItemId}'
    OR NOT EXISTS (
      SELECT 1 FROM public.sepidar_customer_opening_admissions approval
      JOIN public.sepidar_customer_opening_manifests manifest USING (manifest_sha256)
      JOIN public.deployment_operations operation ON operation.id = manifest.deployment_id
      JOIN public.accounting_customer_profiles profile ON profile.id = NEW."profileId"
      WHERE approval.idempotency_key = NEW."idempotencyKey"
        AND approval.approved_total_rials = NEW."totalRials"
        AND (approval.profile_id = profile.id OR approval.crm_customer_id = profile."partySourceId")
        AND approval.actor_id = NEW."createdBy"
        AND approval.command_hash = NEW."commandHash"
        AND approval.source_customer_id = evidence ->> 'sourceCustomerId'
        AND approval.source_voucher_item_id = evidence ->> 'sourceVoucherItemId'
        AND manifest.basis_at = NEW."basisAt" AT TIME ZONE 'UTC'
        AND manifest.source_package_hash = evidence ->> 'sourcePackageHash'
        AND manifest.book_id = evidence ->> 'bookId'
        AND manifest.counter_account_id = evidence ->> 'counterAccountId'
        AND public.sepidar_customer_opening_runtime_admitted(
          operation."targetCommit", manifest.release_id, evidence ->> 'bookId',
          NEW."profileId", NEW."createdBy", NEW."basisAt" AT TIME ZONE 'UTC',
          evidence ->> 'counterAccountId', NEW."commandHash", evidence ->> 'sourcePackageHash',
          evidence ->> 'sourceCustomerId', evidence ->> 'sourceVoucherItemId', NEW."idempotencyKey"
        ) IS TRUE
    ) THEN
    RAISE EXCEPTION 'SEPIDAR_CUSTOMER_OPENING_CLOSED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sepidar_opening_review_requires_admission
  BEFORE INSERT ON public.accounting_customer_opening_reviews
  FOR EACH ROW EXECUTE FUNCTION public.verify_sepidar_customer_opening_review();
REVOKE ALL ON FUNCTION public.verify_sepidar_customer_opening_review() FROM PUBLIC;

REVOKE ALL ON public.sepidar_customer_opening_manifests, public.sepidar_customer_opening_admissions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_sepidar_customer_opening_admission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sepidar_customer_opening_lock(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sepidar_customer_opening_lock(text,text,text) TO sabalan_sepidar_opening_controller;
REVOKE ALL ON FUNCTION public.sepidar_customer_opening_register_manifest(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sepidar_customer_opening_register_manifest(text,text,text,text,text) TO sabalan_sepidar_opening_controller;
REVOKE ALL ON FUNCTION public.sepidar_customer_opening_runtime_admitted(text,text,text,text,text,timestamptz,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sepidar_customer_opening_runtime_admitted(text,text,text,text,text,timestamptz,text,text,text,text,text,text) TO sabalan_application_runtime;
