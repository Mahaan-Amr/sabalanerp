CREATE TYPE "HrWorkScheduleChangeStatus" AS ENUM ('PROPOSED', 'DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');

CREATE TABLE "hr_work_schedule_changes" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "status" "HrWorkScheduleChangeStatus" NOT NULL DEFAULT 'PROPOSED',
  "effectiveFrom" TIMESTAMP(3),
  "daysJson" JSONB,
  "proposalNote" TEXT,
  "proposedBy" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "preparedBy" TEXT,
  "preparedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "returnedBy" TEXT,
  "returnedAt" TIMESTAMP(3),
  "returnReason" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "canonicalScheduleId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_work_schedule_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_work_schedule_changes_personnelId_createdAt_idx" ON "hr_work_schedule_changes"("personnelId", "createdAt");
CREATE INDEX "hr_work_schedule_changes_status_submittedAt_idx" ON "hr_work_schedule_changes"("status", "submittedAt");
ALTER TABLE "hr_work_schedule_changes" ADD CONSTRAINT "hr_work_schedule_changes_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
