ALTER TABLE "performance_export_receipts"
  ADD COLUMN "artifactKeyId" TEXT,
  ADD COLUMN "startedAt" TIMESTAMP(3);

CREATE INDEX "performance_export_receipts_status_startedAt_idx"
  ON "performance_export_receipts"("status", "startedAt");

INSERT INTO "hr_responsibility_type_catalogs" ("id", "code", "version", "displayName", "isActive", "createdAt", "updatedAt")
VALUES
  ('perf-cons-comp-review', 'PERFORMANCE_CONSEQUENCE_COMPENSATION_REVIEW', 1, 'مسئول ایجاد ارجاع بازبینی جبران خدمت', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-cons-bonus-review', 'PERFORMANCE_CONSEQUENCE_DISCRETIONARY_BONUS_REVIEW', 1, 'مسئول ایجاد ارجاع بازبینی پاداش اختیاری', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-cons-promotion', 'PERFORMANCE_CONSEQUENCE_PROMOTION_REVIEW', 1, 'مسئول ایجاد ارجاع بررسی ارتقا', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-cons-improvement', 'PERFORMANCE_CONSEQUENCE_PERFORMANCE_IMPROVEMENT_REVIEW', 1, 'مسئول ایجاد ارجاع برنامه بهبود عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-cons-demotion', 'PERFORMANCE_CONSEQUENCE_DEMOTION_REVIEW', 1, 'مسئول ایجاد ارجاع بررسی تنزل', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
