CREATE TABLE "performance_operation_receipts" (
  "id" TEXT NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "policyVersionId" TEXT,
  "intentHash" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_operation_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_operation_receipts_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_operation_receipts_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "performance_operation_receipts_idempotency_key" ON "performance_operation_receipts"("idempotencyKeyHash");
CREATE UNIQUE INDEX "performance_operation_receipts_payload_key" ON "performance_operation_receipts"("encryptedPayloadId");
CREATE INDEX "performance_operation_receipts_kind_completed_idx" ON "performance_operation_receipts"("operationKind", "completedAt");

CREATE TABLE "performance_artifact_snapshot_bindings" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "artifactType" TEXT NOT NULL,
  "policyVersionId" TEXT,
  "criterionVersionId" TEXT,
  "templateVersionId" TEXT,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_artifact_snapshot_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_artifact_snapshot_bindings_snapshot_fkey" FOREIGN KEY ("snapshotId") REFERENCES "performance_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_artifact_snapshot_bindings_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_artifact_snapshot_bindings_criterion_fkey" FOREIGN KEY ("criterionVersionId") REFERENCES "performance_criterion_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_artifact_snapshot_bindings_template_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "performance_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_artifact_snapshot_bindings_target_check" CHECK (
    (("policyVersionId" IS NOT NULL)::INTEGER + ("criterionVersionId" IS NOT NULL)::INTEGER + ("templateVersionId" IS NOT NULL)::INTEGER) = 1
  )
);
CREATE UNIQUE INDEX "performance_artifact_snapshot_bindings_unique_target" ON "performance_artifact_snapshot_bindings"(
  "snapshotId", "artifactType", COALESCE("policyVersionId", ''), COALESCE("criterionVersionId", ''), COALESCE("templateVersionId", '')
);
CREATE INDEX "performance_artifact_snapshot_bindings_snapshot_idx" ON "performance_artifact_snapshot_bindings"("snapshotId", "artifactType");
CREATE INDEX "performance_artifact_snapshot_bindings_policy_idx" ON "performance_artifact_snapshot_bindings"("policyVersionId");
CREATE INDEX "performance_artifact_snapshot_bindings_criterion_idx" ON "performance_artifact_snapshot_bindings"("criterionVersionId");
CREATE INDEX "performance_artifact_snapshot_bindings_template_idx" ON "performance_artifact_snapshot_bindings"("templateVersionId");

CREATE UNIQUE INDEX "performance_criterion_versions_one_active_identity"
  ON "performance_criterion_versions"("criterionIdentityId") WHERE "lifecycle" = 'ACTIVE';
CREATE UNIQUE INDEX "performance_template_versions_one_active_owner"
  ON "performance_template_versions"("templateKind", "ownerType", "ownerId") WHERE "lifecycle" = 'ACTIVE';

CREATE OR REPLACE FUNCTION performance_reject_policy_engine_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'personnel performance policy evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_operation_receipts_append_only
BEFORE UPDATE OR DELETE ON "performance_operation_receipts"
FOR EACH ROW EXECUTE FUNCTION performance_reject_policy_engine_evidence_mutation();
CREATE TRIGGER performance_artifact_snapshot_bindings_append_only
BEFORE UPDATE OR DELETE ON "performance_artifact_snapshot_bindings"
FOR EACH ROW EXECUTE FUNCTION performance_reject_policy_engine_evidence_mutation();

CREATE OR REPLACE FUNCTION performance_guard_version_mutation()
RETURNS trigger AS $$
DECLARE
  old_state TEXT;
  new_state TEXT := NEW."lifecycle"::TEXT;
  immutable_old JSONB;
  immutable_new JSONB;
  preview RECORD;
  snapshot_reference_exists BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN
      RAISE EXCEPTION 'performance versions must begin as drafts';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."lifecycle"::TEXT;
  IF old_state = new_state AND old_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'published performance version is immutable';
  END IF;
  IF old_state = 'SCHEDULED' AND new_state = 'CANCELLED' THEN
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
  IF TG_TABLE_NAME = 'performance_policy_versions' AND old_state = 'DRAFT' AND new_state = 'SCHEDULED' THEN
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
    immutable_old := to_jsonb(OLD) - 'lifecycle' - 'retiredAt';
    immutable_new := to_jsonb(NEW) - 'lifecycle' - 'retiredAt';
    IF immutable_old IS DISTINCT FROM immutable_new THEN
      RAISE EXCEPTION 'published performance version is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
