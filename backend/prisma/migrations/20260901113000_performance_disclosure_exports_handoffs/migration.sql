ALTER TABLE "performance_export_receipts"
  ADD COLUMN "downloadTokenHash" TEXT,
  ADD COLUMN "downloadTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "artifactPath" TEXT,
  ADD COLUMN "artifactMimeType" TEXT,
  ADD COLUMN "artifactSize" INTEGER,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "performance_export_receipts_download_token_key"
  ON "performance_export_receipts"("downloadTokenHash");

ALTER TABLE "performance_export_receipts"
  ADD CONSTRAINT "performance_export_receipts_artifact_size_check"
  CHECK ("artifactSize" IS NULL OR "artifactSize" >= 0),
  ADD CONSTRAINT "performance_export_receipts_download_state_check"
  CHECK ("downloadedAt" IS NULL OR "status" IN ('DOWNLOADED', 'DELETED'));

CREATE TABLE "performance_peer_family_versions" (
  "id" TEXT NOT NULL,
  "familyKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "membershipHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_peer_family_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "performance_peer_family_versions_family_version_key"
  ON "performance_peer_family_versions"("familyKey", "version");
CREATE INDEX "performance_peer_family_versions_lifecycle_effective_idx"
  ON "performance_peer_family_versions"("lifecycle", "effectiveFrom");

CREATE TABLE "performance_peer_family_jobs" (
  "id" TEXT NOT NULL,
  "familyVersionId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_peer_family_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_peer_family_jobs_family_fkey" FOREIGN KEY ("familyVersionId") REFERENCES "performance_peer_family_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_peer_family_jobs_job_fkey" FOREIGN KEY ("jobId") REFERENCES "hr_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "performance_peer_family_jobs_family_job_key"
  ON "performance_peer_family_jobs"("familyVersionId", "jobId");
CREATE INDEX "performance_peer_family_jobs_job_family_idx"
  ON "performance_peer_family_jobs"("jobId", "familyVersionId");

CREATE TABLE "performance_consequence_handoffs" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "employmentRelationshipId" TEXT NOT NULL,
  "consequenceType" TEXT NOT NULL,
  "policyCycleKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SENT',
  "reasonCategory" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "supersedesHandoffId" TEXT,
  CONSTRAINT "performance_consequence_handoffs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_consequence_handoffs_subject_fkey" FOREIGN KEY ("subjectId") REFERENCES "performance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_personnel_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_relationship_fkey" FOREIGN KEY ("employmentRelationshipId") REFERENCES "hr_employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_supersedes_fkey" FOREIGN KEY ("supersedesHandoffId") REFERENCES "performance_consequence_handoffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_handoffs_type_check" CHECK ("consequenceType" IN ('COMPENSATION_REVIEW', 'DISCRETIONARY_BONUS_REVIEW', 'PROMOTION_REVIEW', 'PERFORMANCE_IMPROVEMENT_REVIEW', 'DEMOTION_REVIEW')),
  CONSTRAINT "performance_consequence_handoffs_status_check" CHECK ("status" IN ('SENT', 'RECEIVED', 'RETURNED', 'WITHDRAWN', 'REPLACED', 'SUSPENDED', 'CLOSED'))
);

CREATE UNIQUE INDEX "performance_consequence_handoffs_payload_key"
  ON "performance_consequence_handoffs"("encryptedPayloadId");
CREATE INDEX "performance_consequence_handoffs_subject_type_status_idx"
  ON "performance_consequence_handoffs"("subjectId", "consequenceType", "status");
CREATE INDEX "performance_consequence_handoffs_relationship_created_idx"
  ON "performance_consequence_handoffs"("employmentRelationshipId", "createdAt");
CREATE UNIQUE INDEX "performance_consequence_handoffs_one_active_key"
  ON "performance_consequence_handoffs"("personnelId", "employmentRelationshipId", "consequenceType", "policyCycleKey")
  WHERE "status" IN ('SENT', 'RECEIVED', 'SUSPENDED');

CREATE OR REPLACE FUNCTION performance_reject_consequence_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW."subjectId" <> OLD."subjectId"
    OR NEW."personnelId" <> OLD."personnelId"
    OR NEW."employmentRelationshipId" <> OLD."employmentRelationshipId"
    OR NEW."consequenceType" <> OLD."consequenceType"
    OR NEW."policyCycleKey" <> OLD."policyCycleKey"
    OR NEW."reasonCategory" <> OLD."reasonCategory"
    OR NEW."reason" <> OLD."reason"
    OR NEW."encryptedPayloadId" <> OLD."encryptedPayloadId"
    OR NEW."snapshotHash" <> OLD."snapshotHash"
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'performance consequence handoff evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performance_consequence_handoff_snapshot_immutable
BEFORE UPDATE ON "performance_consequence_handoffs"
FOR EACH ROW EXECUTE FUNCTION performance_reject_consequence_snapshot_mutation();
