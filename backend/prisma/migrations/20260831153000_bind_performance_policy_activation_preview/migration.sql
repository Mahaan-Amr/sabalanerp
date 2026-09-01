CREATE TABLE "performance_policy_activation_previews" (
  "id" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "policyContentHash" TEXT NOT NULL,
  "populationHash" TEXT NOT NULL,
  "eligibleSubjectCount" INTEGER NOT NULL,
  "evaluatedSubjectCount" INTEGER NOT NULL,
  "errorCount" INTEGER NOT NULL,
  "resultHash" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "confirmedByUserId" TEXT NOT NULL,
  CONSTRAINT "performance_policy_activation_previews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_policy_activation_previews_policy_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "performance_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_activation_previews_confirmer_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_policy_activation_previews_complete_check" CHECK (
    "eligibleSubjectCount" >= 0
    AND "evaluatedSubjectCount" = "eligibleSubjectCount"
    AND "errorCount" = 0
    AND "confirmedAt" >= "generatedAt"
  )
);
CREATE UNIQUE INDEX "performance_policy_activation_previews_policy_key" ON "performance_policy_activation_previews"("policyVersionId");
CREATE INDEX "performance_policy_activation_previews_confirmer_idx" ON "performance_policy_activation_previews"("confirmedByUserId", "confirmedAt");

ALTER TABLE "performance_policy_versions" ADD COLUMN "activationPreviewId" TEXT;
CREATE UNIQUE INDEX "performance_policy_versions_activation_preview_key" ON "performance_policy_versions"("activationPreviewId");
ALTER TABLE "performance_policy_versions" ADD CONSTRAINT "performance_policy_versions_activation_preview_fkey" FOREIGN KEY ("activationPreviewId") REFERENCES "performance_policy_activation_previews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_policy_versions" DROP CONSTRAINT "performance_policy_versions_activation_evidence_check";
ALTER TABLE "performance_policy_versions" ADD CONSTRAINT "performance_policy_versions_activation_evidence_check" CHECK (
  "lifecycle" = 'DRAFT'
  OR (
    "activationPreviewId" IS NOT NULL
    AND "activationPreviewHash" IS NOT NULL
    AND "activationConfirmedAt" IS NOT NULL
    AND "publishedAt" IS NOT NULL
    AND "effectiveFrom" >= "publishedAt"
    AND "activationConfirmedAt" <= "publishedAt"
  )
);

CREATE OR REPLACE FUNCTION performance_reject_activation_preview_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'performance policy activation preview is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_policy_activation_previews_append_only
BEFORE UPDATE OR DELETE ON "performance_policy_activation_previews"
FOR EACH ROW EXECUTE FUNCTION performance_reject_activation_preview_mutation();

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
    SELECT * INTO preview FROM "performance_policy_activation_previews"
    WHERE "id" = NEW."activationPreviewId"
      AND "policyVersionId" = NEW."id"
      AND "policyContentHash" = NEW."contentHash"
      AND "resultHash" = NEW."activationPreviewHash"
      AND "eligibleSubjectCount" = "evaluatedSubjectCount"
      AND "errorCount" = 0
      AND "confirmedAt" = NEW."activationConfirmedAt";
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
