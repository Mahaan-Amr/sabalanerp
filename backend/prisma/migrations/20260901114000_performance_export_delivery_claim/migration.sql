ALTER TYPE "PerformanceExportStatus" ADD VALUE IF NOT EXISTS 'DELIVERING' AFTER 'READY';

ALTER TABLE "performance_export_receipts" DROP CONSTRAINT IF EXISTS "performance_export_receipts_download_state_check";
ALTER TABLE "performance_export_receipts"
  ADD CONSTRAINT "performance_export_receipts_download_state_check"
  CHECK ("downloadedAt" IS NULL OR "status" IN ('DOWNLOADED', 'DELETED'));
