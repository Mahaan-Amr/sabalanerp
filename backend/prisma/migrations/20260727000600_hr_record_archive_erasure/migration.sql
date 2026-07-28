ALTER TABLE "personnel"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT,
  ADD COLUMN "archiveReason" TEXT,
  ADD COLUMN "archiveEffectiveDate" TIMESTAMP(3);

ALTER TYPE "HrWorkScheduleChangeStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "hr_job_applications"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT,
  ADD COLUMN "archiveReason" TEXT;

ALTER TABLE "hr_payroll_participations"
  ADD COLUMN "effectiveTo" TIMESTAMP(3),
  ADD COLUMN "endedBy" TEXT,
  ADD COLUMN "endReason" TEXT;

CREATE TABLE "hr_deletion_receipts" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "previewFingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "recordCounts" JSONB NOT NULL,
  "fileCounts" JSONB NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_deletion_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personnel_archivedAt_lastName_firstName_idx" ON "personnel"("archivedAt", "lastName", "firstName");
CREATE INDEX "hr_job_applications_archivedAt_updatedAt_idx" ON "hr_job_applications"("archivedAt", "updatedAt");
CREATE INDEX "hr_deletion_receipts_targetType_targetId_idx" ON "hr_deletion_receipts"("targetType", "targetId");
CREATE INDEX "hr_deletion_receipts_actorUserId_createdAt_idx" ON "hr_deletion_receipts"("actorUserId", "createdAt");
CREATE INDEX "hr_deletion_receipts_status_createdAt_idx" ON "hr_deletion_receipts"("status", "createdAt");

CREATE TABLE "hr_deletion_file_cleanups" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "originalPath" TEXT NOT NULL,
  "stagedPath" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_deletion_file_cleanups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_deletion_file_cleanups_receiptId_status_idx" ON "hr_deletion_file_cleanups"("receiptId", "status");
CREATE INDEX "hr_deletion_file_cleanups_status_createdAt_idx" ON "hr_deletion_file_cleanups"("status", "createdAt");
