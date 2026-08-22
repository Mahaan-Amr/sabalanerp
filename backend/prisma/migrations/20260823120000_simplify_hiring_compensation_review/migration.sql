ALTER TABLE "hr_compensation_snapshots"
  ADD COLUMN "payrollReviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "payrollVerifiedBy" TEXT,
  ADD COLUMN "payrollVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "verificationDueAt" TIMESTAMP(3),
  ADD COLUMN "payrollReturnedBy" TEXT,
  ADD COLUMN "payrollReturnedAt" TIMESTAMP(3),
  ADD COLUMN "payrollReturnReasonCode" TEXT,
  ADD COLUMN "payrollReturnReasonDetail" TEXT,
  ADD COLUMN "supersedesSnapshotId" TEXT;

UPDATE "hr_compensation_snapshots"
SET
  "payrollReviewStatus" = 'VERIFIED',
  "payrollVerifiedBy" = COALESCE("hrApprovedBy", "financeApprovedBy"),
  "payrollVerifiedAt" = COALESCE("hrApprovedAt", "financeApprovedAt")
WHERE "hrApprovedAt" IS NOT NULL AND "financeApprovedAt" IS NOT NULL;

CREATE UNIQUE INDEX "hr_compensation_snapshots_supersedesSnapshotId_key"
  ON "hr_compensation_snapshots"("supersedesSnapshotId");
CREATE INDEX "hr_compensation_snapshots_payrollReviewStatus_verificationDueAt_idx"
  ON "hr_compensation_snapshots"("payrollReviewStatus", "verificationDueAt");

ALTER TABLE "hr_compensation_snapshots"
  ADD CONSTRAINT "hr_compensation_snapshots_supersedesSnapshotId_fkey"
  FOREIGN KEY ("supersedesSnapshotId") REFERENCES "hr_compensation_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
