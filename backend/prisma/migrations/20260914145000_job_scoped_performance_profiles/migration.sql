ALTER TABLE "simple_performance_profiles"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "positionId" TEXT,
  ADD COLUMN "positionDifferenceReason" TEXT;

ALTER TABLE "simple_performance_profiles"
  ADD CONSTRAINT "simple_performance_profiles_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "hr_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "simple_performance_profiles_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "simple_performance_profiles_jobId_positionId_effectivePeriodKey_version_idx"
  ON "simple_performance_profiles"("jobId", "positionId", "effectivePeriodKey", "version");
