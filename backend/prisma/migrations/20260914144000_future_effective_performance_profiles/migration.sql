ALTER TABLE "simple_performance_profiles" ADD COLUMN "effectivePeriodKey" TEXT;
CREATE INDEX "simple_performance_profiles_stableKey_effectivePeriodKey_version_idx"
  ON "simple_performance_profiles"("stableKey", "effectivePeriodKey", "version");
