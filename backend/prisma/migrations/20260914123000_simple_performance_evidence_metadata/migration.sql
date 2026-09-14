ALTER TABLE "simple_performance_indicators"
  ADD COLUMN "familyCode" TEXT,
  ADD COLUMN "sourceKind" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "minimumSampleCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "simple_performance_values"
  ADD COLUMN "sampleCount" INTEGER,
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "enteredByUserId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "simple_performance_indicators" ADD CONSTRAINT "simple_performance_indicators_source_check"
  CHECK ("sourceKind" IN ('SYSTEM', 'SUPERVISOR', 'SURVEY'));
ALTER TABLE "simple_performance_indicators" ADD CONSTRAINT "simple_performance_indicators_sample_check"
  CHECK ("minimumSampleCount" > 0);
ALTER TABLE "simple_performance_values" ADD CONSTRAINT "simple_performance_values_sample_check"
  CHECK ("sampleCount" IS NULL OR "sampleCount" >= 0);
