ALTER TABLE "hr_job_applications"
  ADD COLUMN "pendingClosureOutcome" TEXT,
  ADD COLUMN "pendingClosureReason" TEXT,
  ADD COLUMN "pendingClosureRequestedBy" TEXT,
  ADD COLUMN "pendingClosureRequestedAt" TIMESTAMP(3);
