CREATE OR REPLACE FUNCTION public.performance_preserve_first_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $fence$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'canonical first-write evidence is permanent';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'performance disclosure singleton is immutable';
  END IF;
  IF NEW.revision IS NULL OR NEW.revision::numeric - OLD.revision NOT IN (0, 1) THEN
    RAISE EXCEPTION 'performance disclosure revision must stay the same or increase by one';
  END IF;
  IF ROW(NEW."firstCanonicalWriteAt", NEW."firstCanonicalTable", NEW."firstCanonicalIdHash")
    IS NOT DISTINCT FROM ROW(OLD."firstCanonicalWriteAt", OLD."firstCanonicalTable", OLD."firstCanonicalIdHash") THEN
    RETURN NEW;
  END IF;
  IF OLD."firstCanonicalWriteAt" IS NOT NULL OR OLD."firstCanonicalTable" IS NOT NULL OR OLD."firstCanonicalIdHash" IS NOT NULL THEN
    RAISE EXCEPTION 'canonical first-write evidence is immutable';
  END IF;
  IF current_user IS DISTINCT FROM (
    SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID
  ) THEN
    RAISE EXCEPTION 'only the disclosure relation owner may establish canonical first-write evidence' USING ERRCODE = '42501';
  END IF;
  IF NEW."firstCanonicalWriteAt" IS NULL OR NEW."firstCanonicalTable" IS NULL OR NEW."firstCanonicalIdHash" IS NULL THEN
    RAISE EXCEPTION 'canonical first-write evidence must be established together';
  END IF;
  RETURN NEW;
END;
$fence$;

REVOKE EXECUTE ON FUNCTION public.performance_guard_canonical_write() FROM PUBLIC;

DO $authority$
DECLARE
  disclosure CONSTANT regclass := 'public.performance_disclosure_revision'::regclass;
  disclosure_owner oid;
  runtime pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT relowner INTO STRICT disclosure_owner FROM pg_catalog.pg_class WHERE oid = disclosure;
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_proc
    WHERE oid = 'public.performance_guard_canonical_write()'::regprocedure AND proowner = disclosure_owner
  ) THEN
    RAISE EXCEPTION 'performance canonical trigger must be owned by the disclosure relation owner';
  END IF;

  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sabalan_allocation_controller') THEN
    REVOKE EXECUTE ON FUNCTION public.performance_guard_canonical_write() FROM sabalan_allocation_controller;
  END IF;
  SELECT * INTO runtime FROM pg_catalog.pg_roles WHERE rolname = 'sabalan_application_runtime';
  IF NOT FOUND THEN RETURN; END IF;
  REVOKE EXECUTE ON FUNCTION public.performance_guard_canonical_write() FROM sabalan_application_runtime;
  -- An absent or NOLOGIN runtime is the staging baseline. Only the already split
  -- runtime with the predecessor's direct table grant receives UPDATE.
  IF NOT runtime.rolcanlogin THEN RETURN; END IF;
  IF runtime.rolsuper OR runtime.rolcreatedb OR runtime.rolcreaterole OR runtime.rolinherit
    OR runtime.rolreplication OR runtime.rolbypassrls OR runtime.rolconfig IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = runtime.oid OR roleid = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = runtime.oid)
    OR EXISTS (SELECT FROM pg_catalog.pg_shdepend
      WHERE refclassid = 'pg_catalog.pg_authid'::regclass AND refobjid = runtime.oid AND deptype = 'o')
    OR NOT EXISTS (
      SELECT FROM pg_catalog.pg_class AS relation CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
      WHERE relation.oid = disclosure AND acl.grantee = runtime.oid AND acl.grantor = disclosure_owner
        AND acl.privilege_type = 'SELECT' AND NOT acl.is_grantable
    )
    OR EXISTS (
      SELECT FROM pg_catalog.pg_class AS relation CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
      WHERE relation.oid = disclosure AND acl.grantee = runtime.oid
        AND (acl.grantor <> disclosure_owner OR acl.privilege_type NOT IN ('SELECT', 'UPDATE') OR acl.is_grantable)
    ) THEN
    RAISE EXCEPTION 'performance disclosure runtime has no valid split role and predecessor grant';
  END IF;
  GRANT UPDATE ON public.performance_disclosure_revision TO sabalan_application_runtime;
END;
$authority$;

CREATE OR REPLACE FUNCTION public.performance_guard_canonical_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $canonical$
DECLARE body JSONB; subject_id TEXT; evaluation_id TEXT; section_id TEXT; enabled BOOLEAN;
BEGIN
  -- A trigger created before EXECUTE was revoked still resolves this function.
  -- Permit only the existing canonical BEFORE ROW triggers on public tables.
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'BEFORE' OR TG_LEVEL <> 'ROW' OR TG_NARGS <> 0 OR NOT (
    (TG_OP = 'INSERT' AND TG_NAME = 'performance_canonical_write_fence' AND TG_TABLE_NAME IN (
      'performance_policy_versions', 'performance_criterion_versions', 'performance_template_versions',
      'performance_cycles', 'performance_evaluations', 'performance_drafts', 'performance_submissions',
      'performance_reviews', 'performance_accepted_results', 'performance_export_receipts',
      'performance_consequence_handoffs', 'performance_privacy_cases'
    )) OR
    (TG_OP = 'UPDATE' AND TG_NAME = 'performance_canonical_update_fence' AND TG_TABLE_NAME IN (
      'performance_policy_versions', 'performance_criterion_versions', 'performance_template_versions',
      'performance_cycles', 'performance_evaluations', 'performance_evaluation_sections',
      'performance_drafts', 'performance_accepted_results'
    ))
  ) THEN
    RAISE EXCEPTION 'unexpected canonical trigger for performance disclosure evidence' USING ERRCODE = '42501';
  END IF;

  body := to_jsonb(NEW);
  -- Updating the shared fence forces a stale Serializable writer to retry rather than overlook a pause.
  UPDATE public.performance_disclosure_revision SET revision = revision,
    "firstCanonicalWriteAt" = COALESCE("firstCanonicalWriteAt", clock_timestamp()),
    "firstCanonicalTable" = COALESCE("firstCanonicalTable", TG_TABLE_NAME),
    "firstCanonicalIdHash" = COALESCE("firstCanonicalIdHash", encode(sha256(convert_to(body->>'id','UTF8')),'hex')) WHERE id = 1;
  IF TG_TABLE_NAME = 'performance_privacy_cases' THEN RETURN NEW; END IF;
  -- Protective invalidation/suspension/expiry preserves evidence and must remain possible during recovery.
  IF TG_OP = 'UPDATE' AND (
    (TG_TABLE_NAME IN ('performance_evaluations','performance_evaluation_sections') AND body->>'status' = 'INVALIDATED') OR
    (TG_TABLE_NAME = 'performance_accepted_results' AND body->>'status' IN ('SUSPENDED','EXPIRED'))
  ) AND (to_jsonb(NEW) - ARRAY['status','updatedAt','writerVersion']) IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','updatedAt','writerVersion']) THEN RETURN NEW; END IF;
  SELECT "releaseEnabled" INTO enabled FROM public.performance_feature_phase_versions
    WHERE "effectiveFrom" <= clock_timestamp() ORDER BY "effectiveFrom" DESC, version DESC LIMIT 1;
  IF NOT COALESCE(enabled, false) THEN RAISE EXCEPTION 'PERFORMANCE_RELEASE_DISABLED: canonical mutation denied'; END IF;
  subject_id := body->>'subjectId'; evaluation_id := body->>'evaluationId'; section_id := body->>'sectionId';
  IF TG_TABLE_NAME = 'performance_evaluations' THEN evaluation_id := body->>'id'; END IF;
  IF section_id IS NULL AND body->>'submissionId' IS NOT NULL THEN
    SELECT "sectionId" INTO section_id FROM public.performance_submissions WHERE id = body->>'submissionId';
  END IF;
  IF evaluation_id IS NULL AND section_id IS NOT NULL THEN
    SELECT "evaluationId" INTO evaluation_id FROM public.performance_evaluation_sections WHERE id = section_id;
  END IF;
  IF subject_id IS NULL AND evaluation_id IS NOT NULL THEN
    SELECT "subjectId" INTO subject_id FROM public.performance_evaluations WHERE id = evaluation_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.performance_safety_pauses pause WHERE pause.status = 'ACTIVE' AND
    (subject_id IS NULL OR pause.scope = 'ALL' OR EXISTS (SELECT 1 FROM public.performance_cohort_members member
      WHERE member."cohortVersionId" = pause."cohortVersionId" AND member."subjectId" = subject_id))) THEN
    RAISE EXCEPTION 'PERFORMANCE_SAFETY_PAUSED: canonical mutation denied';
  END IF;
  RETURN NEW;
END;
$canonical$;
