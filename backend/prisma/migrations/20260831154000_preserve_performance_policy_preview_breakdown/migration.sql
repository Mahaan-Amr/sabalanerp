ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "encryptedPayloadId" TEXT NOT NULL;
ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "increasedCount" INTEGER NOT NULL;
ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "decreasedCount" INTEGER NOT NULL;
ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "unchangedCount" INTEGER NOT NULL;
ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "expiredCount" INTEGER NOT NULL;
ALTER TABLE "performance_policy_activation_previews" ADD COLUMN "needsNewEvaluationCount" INTEGER NOT NULL;
CREATE UNIQUE INDEX "performance_policy_activation_previews_payload_key" ON "performance_policy_activation_previews"("encryptedPayloadId");
ALTER TABLE "performance_policy_activation_previews" ADD CONSTRAINT "performance_policy_activation_previews_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_policy_activation_previews" DROP CONSTRAINT "performance_policy_activation_previews_complete_check";
ALTER TABLE "performance_policy_activation_previews" ADD CONSTRAINT "performance_policy_activation_previews_complete_check" CHECK (
  "eligibleSubjectCount" >= 0
  AND "evaluatedSubjectCount" = "eligibleSubjectCount"
  AND "increasedCount" >= 0
  AND "decreasedCount" >= 0
  AND "unchangedCount" >= 0
  AND "expiredCount" >= 0
  AND "needsNewEvaluationCount" >= 0
  AND "increasedCount" + "decreasedCount" + "unchangedCount" + "expiredCount" + "needsNewEvaluationCount" = "evaluatedSubjectCount"
  AND "errorCount" = 0
  AND "confirmedAt" >= "generatedAt"
);

CREATE OR REPLACE FUNCTION performance_guard_version_mutation()
RETURNS trigger AS $$
DECLARE
  old_state TEXT;
  new_state TEXT := NEW."lifecycle"::TEXT;
  immutable_old JSONB;
  immutable_new JSONB;
  preview RECORD;
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
  IF old_state <> new_state AND NOT (
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
