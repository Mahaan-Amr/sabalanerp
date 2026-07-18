-- CreateEnum
CREATE TYPE "AttendanceWorkScheduleStatus" AS ENUM ('UNCONFIGURED', 'NON_WORKING_DAY', 'WORKDAY');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'PENDING';
ALTER TYPE "AttendanceStatus" ADD VALUE 'NON_WORKING_DAY';

-- AlterTable
ALTER TABLE "attendance_records"
ADD COLUMN "workScheduleStatus" "AttendanceWorkScheduleStatus",
ADD COLUMN "scheduledStartTime" TEXT,
ADD COLUMN "scheduledEndTime" TEXT,
ADD COLUMN "delayMinutes" INTEGER,
ADD COLUMN "overtimeMinutes" INTEGER,
ADD COLUMN "overtimePending" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "personnel_work_schedules" (
    "id" TEXT NOT NULL,
    "personnelId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personnel_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personnel_work_schedule_days" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    CONSTRAINT "personnel_work_schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personnel_work_schedules_personnelId_effectiveFrom_key" ON "personnel_work_schedules"("personnelId", "effectiveFrom");
CREATE INDEX "personnel_work_schedules_personnelId_effectiveFrom_idx" ON "personnel_work_schedules"("personnelId", "effectiveFrom");
CREATE UNIQUE INDEX "personnel_work_schedule_days_scheduleId_weekday_key" ON "personnel_work_schedule_days"("scheduleId", "weekday");
CREATE INDEX "personnel_work_schedule_days_weekday_idx" ON "personnel_work_schedule_days"("weekday");

-- AddForeignKey
ALTER TABLE "personnel_work_schedules" ADD CONSTRAINT "personnel_work_schedules_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_work_schedule_days" ADD CONSTRAINT "personnel_work_schedule_days_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "personnel_work_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
