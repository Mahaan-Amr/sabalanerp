CREATE TYPE "SecurityShiftPlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');
CREATE TYPE "SecurityShiftCoverageStatus" AS ENUM ('COVERED', 'NEEDS_REPLACEMENT', 'EMERGENCY_UNCOVERED');
CREATE TYPE "SecurityShiftSessionStatus" AS ENUM ('ACTIVE', 'CLOSED', 'FORCE_CLOSED');

CREATE TABLE "security_shift_plans" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "persianYear" INTEGER NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "SecurityShiftPlanStatus" NOT NULL DEFAULT 'DRAFT', "anchorAt" TIMESTAMP(3) NOT NULL, "generateUntil" TIMESTAMP(3) NOT NULL,
  "slotDurationMinutes" INTEGER NOT NULL DEFAULT 720, "earlyArrivalMinutes" INTEGER NOT NULL DEFAULT 30, "lateAlertMinutes" INTEGER NOT NULL DEFAULT 15,
  "primaryAId" TEXT NOT NULL, "primaryBId" TEXT NOT NULL, "primaryCId" TEXT NOT NULL, "replacesPlanId" TEXT,
  "createdBy" TEXT NOT NULL, "publishedBy" TEXT, "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_shift_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_shift_plans_primaryAId_fkey" FOREIGN KEY ("primaryAId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_shift_plans_primaryBId_fkey" FOREIGN KEY ("primaryBId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_shift_plans_primaryCId_fkey" FOREIGN KEY ("primaryCId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "security_shift_plans_persianYear_status_idx" ON "security_shift_plans"("persianYear", "status");
CREATE INDEX "security_shift_plans_anchorAt_generateUntil_idx" ON "security_shift_plans"("anchorAt", "generateUntil");

CREATE TABLE "security_shift_plan_slots" (
  "id" TEXT NOT NULL, "planId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "plannedPersonnelId" TEXT NOT NULL, "replacementPersonnelId" TEXT, "coverageStatus" "SecurityShiftCoverageStatus" NOT NULL DEFAULT 'COVERED',
  "leaveRequestId" TEXT, "overrideReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_shift_plan_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_shift_plan_slots_planId_fkey" FOREIGN KEY ("planId") REFERENCES "security_shift_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "security_shift_plan_slots_plannedPersonnelId_fkey" FOREIGN KEY ("plannedPersonnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_shift_plan_slots_replacementPersonnelId_fkey" FOREIGN KEY ("replacementPersonnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "security_shift_plan_slots_planId_sequence_key" ON "security_shift_plan_slots"("planId", "sequence");
CREATE INDEX "security_shift_plan_slots_startsAt_endsAt_idx" ON "security_shift_plan_slots"("startsAt", "endsAt");
CREATE INDEX "security_shift_plan_slots_plannedPersonnelId_startsAt_idx" ON "security_shift_plan_slots"("plannedPersonnelId", "startsAt");
CREATE INDEX "security_shift_plan_slots_replacementPersonnelId_startsAt_idx" ON "security_shift_plan_slots"("replacementPersonnelId", "startsAt");
CREATE INDEX "security_shift_plan_slots_coverageStatus_startsAt_idx" ON "security_shift_plan_slots"("coverageStatus", "startsAt");

CREATE TABLE "security_shift_attendance" (
  "id" TEXT NOT NULL, "slotId" TEXT NOT NULL, "personnelId" TEXT NOT NULL, "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "delayMinutes" INTEGER NOT NULL DEFAULT 0, "originalArrivedAt" TIMESTAMP(3), "correctedAt" TIMESTAMP(3), "correctedBy" TEXT, "correctionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_shift_attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_shift_attendance_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "security_shift_plan_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "security_shift_attendance_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "security_shift_attendance_slotId_personnelId_key" ON "security_shift_attendance"("slotId", "personnelId");
CREATE INDEX "security_shift_attendance_personnelId_arrivedAt_idx" ON "security_shift_attendance"("personnelId", "arrivedAt");

CREATE TABLE "security_shift_sessions" (
  "id" TEXT NOT NULL, "slotId" TEXT NOT NULL, "personnelId" TEXT NOT NULL, "status" "SecurityShiftSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3), "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "forceClosedBy" TEXT, "forceCloseReason" TEXT, "closureSummary" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_shift_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_shift_sessions_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "security_shift_plan_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_shift_sessions_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "security_shift_sessions_slotId_key" ON "security_shift_sessions"("slotId");
CREATE INDEX "security_shift_sessions_status_startedAt_idx" ON "security_shift_sessions"("status", "startedAt");
CREATE INDEX "security_shift_sessions_personnelId_startedAt_idx" ON "security_shift_sessions"("personnelId", "startedAt");

CREATE TABLE "security_shift_temporary_coverage" (
  "id" TEXT NOT NULL, "slotId" TEXT NOT NULL, "personnelId" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "note" TEXT, "assignedBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_shift_temporary_coverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_shift_temporary_coverage_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "security_shift_plan_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "security_shift_temporary_coverage_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "security_shift_temporary_coverage_slotId_startsAt_idx" ON "security_shift_temporary_coverage"("slotId", "startsAt");
CREATE INDEX "security_shift_temporary_coverage_personnelId_startsAt_idx" ON "security_shift_temporary_coverage"("personnelId", "startsAt");

ALTER TABLE "security_supervisor_reports" ADD COLUMN "planSlotId" TEXT;
CREATE UNIQUE INDEX "security_supervisor_reports_planSlotId_key" ON "security_supervisor_reports"("planSlotId");
ALTER TABLE "security_supervisor_reports" ADD CONSTRAINT "security_supervisor_reports_planSlotId_fkey" FOREIGN KEY ("planSlotId") REFERENCES "security_shift_plan_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
