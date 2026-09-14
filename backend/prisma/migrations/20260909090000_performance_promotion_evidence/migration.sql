ALTER TABLE "performance_cohort_versions"
  ADD COLUMN "targetPhase" "PerformanceRolloutPhase",
  ADD COLUMN "promotionEvidenceId" TEXT;

ALTER TABLE "performance_rollout_decisions"
  ADD COLUMN "promotionEvidenceId" TEXT;

ALTER TABLE "performance_feature_phase_versions"
  ADD COLUMN "promotionEvidenceId" TEXT;

INSERT INTO "hr_feature_catalogs" ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-record-performance-promotion-evidence', 'RECORD_PERFORMANCE_PROMOTION_EVIDENCE', 'HUMAN_RESOURCES', 1,
  'ثبت و ابطال بسته شواهد ارتقای عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "hr_workspace_catalogs" WHERE "code" = 'HUMAN_RESOURCES')
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "performance_promotion_evidence" (
  "id" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "releaseCommit" TEXT NOT NULL,
  "releaseSourceHash" TEXT NOT NULL,
  "releaseSchemaHash" TEXT NOT NULL,
  "releasePolicyHash" TEXT NOT NULL,
  "releaseInfrastructureHash" TEXT NOT NULL,
  "backendImageDigest" TEXT NOT NULL,
  "frontendImageDigest" TEXT NOT NULL,
  "inquiryImageDigest" TEXT NOT NULL,
  "targetPhase" "PerformanceRolloutPhase" NOT NULL,
  "targetCohortVersionId" TEXT NOT NULL,
  "targetCohortStage" TEXT NOT NULL,
  "targetMembershipHash" TEXT NOT NULL,
  "targetReadyPopulation" INTEGER NOT NULL,
  "targetMemberCount" INTEGER NOT NULL,
  "targetGate" INTEGER NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "attestationKeyId" TEXT NOT NULL,
  "authenticatedByUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_promotion_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_promotion_evidence_hash_key" UNIQUE ("evidenceHash"),
  CONSTRAINT "performance_promotion_evidence_payload_key" UNIQUE ("encryptedPayloadId"),
  CONSTRAINT "performance_promotion_evidence_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_promotion_evidence_actor_fkey" FOREIGN KEY ("authenticatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_promotion_evidence_cohort_fkey" FOREIGN KEY ("targetCohortVersionId") REFERENCES "performance_cohort_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_promotion_evidence_shape_check" CHECK (
    "evidenceHash" ~ '^[a-f0-9]{64}$' AND "manifestHash" ~ '^[a-f0-9]{64}$'
    AND "releaseCommit" ~ '^[a-f0-9]{40}$'
    AND "releaseSourceHash" ~ '^[a-f0-9]{64}$' AND "releaseSchemaHash" ~ '^[a-f0-9]{64}$'
    AND "releasePolicyHash" ~ '^[a-f0-9]{64}$' AND "releaseInfrastructureHash" ~ '^[a-f0-9]{64}$'
    AND "backendImageDigest" ~ '^sha256:[a-f0-9]{64}$' AND "frontendImageDigest" ~ '^sha256:[a-f0-9]{64}$'
    AND "inquiryImageDigest" ~ '^sha256:[a-f0-9]{64}$'
    AND "targetCohortStage" IN ('PILOT','TEN_PERCENT','TWENTY_FIVE_PERCENT','FIFTY_PERCENT','ALL')
    AND "targetMembershipHash" ~ '^[a-f0-9]{64}$'
    AND "targetReadyPopulation" > 0 AND "targetMemberCount" > 0 AND "targetMemberCount" <= "targetReadyPopulation"
    AND "targetGate" BETWEEN 1 AND 9 AND "verifiedAt" < "validUntil"
  )
);
CREATE INDEX "performance_promotion_evidence_target_idx"
  ON "performance_promotion_evidence"("targetCohortVersionId", "targetPhase", "validUntil");

CREATE TABLE "performance_promotion_evidence_revocations" (
  "id" TEXT NOT NULL,
  "promotionEvidenceId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "revokedByUserId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_promotion_evidence_revocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_promotion_evidence_revocation_evidence_fkey" FOREIGN KEY ("promotionEvidenceId") REFERENCES "performance_promotion_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_promotion_evidence_revocation_actor_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_promotion_evidence_revocation_reason_check" CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{2,79}$')
);
CREATE INDEX "performance_promotion_evidence_revocation_idx"
  ON "performance_promotion_evidence_revocations"("promotionEvidenceId", "revokedAt");

ALTER TABLE "performance_rollout_decisions" ADD CONSTRAINT "performance_rollout_decision_promotion_evidence_fkey"
  FOREIGN KEY ("promotionEvidenceId") REFERENCES "performance_promotion_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_cohort_versions" ADD CONSTRAINT "performance_cohort_promotion_evidence_fkey"
  FOREIGN KEY ("promotionEvidenceId") REFERENCES "performance_promotion_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_feature_phase_versions" ADD CONSTRAINT "performance_phase_promotion_evidence_fkey"
  FOREIGN KEY ("promotionEvidenceId") REFERENCES "performance_promotion_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER performance_promotion_evidence_immutable BEFORE UPDATE OR DELETE ON "performance_promotion_evidence"
  FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_promotion_evidence_revocations_immutable BEFORE UPDATE OR DELETE ON "performance_promotion_evidence_revocations"
  FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();

CREATE OR REPLACE FUNCTION performance_guard_cohort_governance()
RETURNS trigger AS $$
DECLARE approved_count INTEGER;
DECLARE member_count INTEGER;
DECLARE evidence_row "performance_promotion_evidence"%ROWTYPE;
BEGIN
  IF NEW."lifecycle" IN ('SCHEDULED','ACTIVE') AND OLD."lifecycle" IN ('DRAFT','SCHEDULED') AND NEW."stage" IS NOT NULL THEN
    IF NEW."promotionEvidenceId" IS NULL OR NEW."targetPhase" IS NULL THEN
      RAISE EXCEPTION 'performance cohort requires verified promotion evidence';
    END IF;
    SELECT * INTO evidence_row FROM "performance_promotion_evidence" WHERE "id" = NEW."promotionEvidenceId" FOR SHARE;
    IF NOT FOUND OR evidence_row."targetCohortVersionId" <> NEW."id"
      OR evidence_row."targetCohortStage" <> NEW."stage" OR evidence_row."targetMembershipHash" <> NEW."membershipHash"
      OR evidence_row."targetPhase" <> NEW."targetPhase"
      OR (NEW."lifecycle" = 'SCHEDULED' AND evidence_row."validUntil" <= NEW."effectiveFrom")
      OR (NEW."lifecycle" = 'ACTIVE' AND evidence_row."validUntil" <= clock_timestamp())
      OR EXISTS (SELECT 1 FROM "performance_promotion_evidence_revocations" r WHERE r."promotionEvidenceId" = evidence_row."id") THEN
      RAISE EXCEPTION 'performance cohort promotion evidence is missing, stale, revoked or unrelated';
    END IF;
    SELECT count(*) INTO member_count FROM "performance_cohort_members" WHERE "cohortVersionId" = NEW."id";
    IF member_count <> evidence_row."targetMemberCount" THEN
      RAISE EXCEPTION 'performance cohort promotion population changed';
    END IF;
    SELECT count(DISTINCT "ownerType") INTO approved_count
    FROM "performance_rollout_decisions" latest
    WHERE latest."scopeType" = 'COHORT' AND latest."scopeId" = NEW."id" AND latest."action" = 'APPROVE'
      AND latest."promotionEvidenceId" = evidence_row."id"
      AND NOT EXISTS (SELECT 1 FROM "performance_rollout_decisions" later
        WHERE later."scopeType" = latest."scopeType" AND later."scopeId" = latest."scopeId"
          AND later."ownerType" = latest."ownerType" AND later."version" > latest."version");
    IF approved_count <> 3 THEN
      RAISE EXCEPTION 'performance cohort requires three current owner approvals for exact promotion evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
