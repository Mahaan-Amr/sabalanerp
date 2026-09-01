CREATE OR REPLACE FUNCTION performance_guard_version_mutation()
RETURNS trigger AS $$
DECLARE
  old_state TEXT;
  new_state TEXT := NEW."lifecycle"::TEXT;
  immutable_old JSONB;
  immutable_new JSONB;
  preview RECORD;
  snapshot_reference_exists BOOLEAN := FALSE;
  is_policy_reconfirmation BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN
      RAISE EXCEPTION 'performance versions must begin as drafts';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."lifecycle"::TEXT;
  IF TG_TABLE_NAME = 'performance_policy_versions'
    AND old_state = 'SCHEDULED' AND new_state = 'SCHEDULED' THEN
    is_policy_reconfirmation := OLD."effectiveFrom" <= CURRENT_TIMESTAMP
      AND NEW."effectiveFrom" > CURRENT_TIMESTAMP
      AND NEW."effectiveFrom" > OLD."effectiveFrom"
      AND NEW."activationPreviewId" IS DISTINCT FROM OLD."activationPreviewId";
  END IF;
  IF old_state = new_state AND old_state <> 'DRAFT' AND NOT is_policy_reconfirmation THEN
    RAISE EXCEPTION 'published performance version is immutable';
  END IF;
  IF old_state = 'SCHEDULED' AND new_state = 'CANCELLED' THEN
    IF OLD."effectiveFrom" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'scheduled performance version cannot be cancelled after its effective time';
    END IF;
    IF TG_TABLE_NAME = 'performance_policy_versions' THEN
      SELECT EXISTS (SELECT 1 FROM "performance_artifact_snapshot_bindings" WHERE "policyVersionId" = OLD."id") INTO snapshot_reference_exists;
    ELSIF TG_TABLE_NAME = 'performance_criterion_versions' THEN
      SELECT EXISTS (SELECT 1 FROM "performance_artifact_snapshot_bindings" WHERE "criterionVersionId" = OLD."id") INTO snapshot_reference_exists;
    ELSIF TG_TABLE_NAME = 'performance_template_versions' THEN
      SELECT EXISTS (SELECT 1 FROM "performance_artifact_snapshot_bindings" WHERE "templateVersionId" = OLD."id") INTO snapshot_reference_exists;
    END IF;
    IF snapshot_reference_exists THEN
      RAISE EXCEPTION 'referenced scheduled performance version cannot be cancelled';
    END IF;
  ELSIF old_state <> new_state AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state = 'ACTIVE') OR
    (old_state = 'ACTIVE' AND new_state = 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'invalid performance version lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_policy_versions'
    AND ((old_state = 'DRAFT' AND new_state = 'SCHEDULED') OR is_policy_reconfirmation) THEN
    SELECT p.* INTO preview
    FROM "performance_policy_activation_previews" p
    JOIN "performance_encrypted_payloads" encrypted ON encrypted."id" = p."encryptedPayloadId"
    WHERE p."id" = NEW."activationPreviewId"
      AND p."policyVersionId" = NEW."id"
      AND p."policyContentHash" = NEW."contentHash"
      AND p."resultHash" = NEW."activationPreviewHash"
      AND encrypted."aggregateType" = 'POLICY_ACTIVATION_PREVIEW'
      AND encrypted."aggregateId" = p."id"
      AND encrypted."plaintextHash" = p."resultHash"
      AND p."eligibleSubjectCount" = p."evaluatedSubjectCount"
      AND p."increasedCount" + p."decreasedCount" + p."unchangedCount" + p."expiredCount" + p."needsNewEvaluationCount" = p."evaluatedSubjectCount"
      AND p."errorCount" = 0
      AND p."confirmedAt" = NEW."activationConfirmedAt";
    IF preview."id" IS NULL THEN
      RAISE EXCEPTION 'performance policy scheduling requires a complete confirmed activation preview';
    END IF;
  END IF;
  IF old_state = 'SCHEDULED' AND new_state = 'ACTIVE' THEN
    IF NEW."effectiveFrom" > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'performance version cannot activate before its effective time';
    END IF;
    IF TG_TABLE_NAME = 'performance_policy_versions'
      AND NEW."effectiveFrom" < CURRENT_TIMESTAMP - INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'performance policy activation cannot be retroactive';
    END IF;
  END IF;
  IF old_state <> 'DRAFT' THEN
    IF is_policy_reconfirmation THEN
      immutable_old := to_jsonb(OLD) - 'lifecycle' - 'retiredAt' - 'effectiveFrom' - 'publicationReason'
        - 'publishedByUserId' - 'publishedAt' - 'activationPreviewId' - 'activationPreviewHash' - 'activationConfirmedAt';
      immutable_new := to_jsonb(NEW) - 'lifecycle' - 'retiredAt' - 'effectiveFrom' - 'publicationReason'
        - 'publishedByUserId' - 'publishedAt' - 'activationPreviewId' - 'activationPreviewHash' - 'activationConfirmedAt';
    ELSE
      immutable_old := to_jsonb(OLD) - 'lifecycle' - 'retiredAt';
      immutable_new := to_jsonb(NEW) - 'lifecycle' - 'retiredAt';
    END IF;
    IF immutable_old IS DISTINCT FROM immutable_new THEN
      RAISE EXCEPTION 'published performance version is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
