UPDATE "simple_performance_profiles"
SET "isActive" = false
WHERE "jobId" IS NULL;

DROP INDEX "simple_performance_profiles_jobId_positionId_effectivePeriodKey_version_idx";

ALTER TABLE "simple_performance_profiles"
  DROP CONSTRAINT "simple_performance_profiles_positionId_fkey",
  DROP COLUMN "positionDifferenceReason",
  DROP COLUMN "positionId";

CREATE INDEX "simple_performance_profiles_jobId_effectivePeriodKey_version_idx"
  ON "simple_performance_profiles"("jobId", "effectivePeriodKey", "version");
