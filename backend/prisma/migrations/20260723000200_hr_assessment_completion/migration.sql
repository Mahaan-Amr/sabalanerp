ALTER TABLE "hr_job_applications"
  ADD COLUMN "assessmentCompletedBy" TEXT,
  ADD COLUMN "assessmentCompletedAt" TIMESTAMP(3),
  ADD COLUMN "assessmentReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assessmentReviewAcknowledgedBy" TEXT,
  ADD COLUMN "assessmentReviewAcknowledgedAt" TIMESTAMP(3);

ALTER TABLE "hr_candidate_assessments"
  ADD COLUMN "version" INTEGER,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "supersedesAssessmentId" TEXT,
  ADD COLUMN "voidedBy" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT;

WITH ranked_assessments AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "applicationId", "assessmentType"
      ORDER BY "recordedAt" ASC, "id" ASC
    ) AS assessment_version
  FROM "hr_candidate_assessments"
)
UPDATE "hr_candidate_assessments" AS assessment
SET "version" = ranked_assessments.assessment_version
FROM ranked_assessments
WHERE assessment."id" = ranked_assessments."id";

ALTER TABLE "hr_candidate_assessments"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL;

CREATE UNIQUE INDEX "hr_candidate_assessments_applicationId_assessmentType_version_key"
  ON "hr_candidate_assessments"("applicationId", "assessmentType", "version");
