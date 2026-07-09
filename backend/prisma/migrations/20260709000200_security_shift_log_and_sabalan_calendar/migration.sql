CREATE TYPE "SecurityShiftLogStatus" AS ENUM ('ACTIVE', 'VOIDED');
CREATE TYPE "SecurityPatrolStatus" AS ENUM ('ACTIVE', 'FINISHED');
CREATE TYPE "SabalanCalendarEventType" AS ENUM ('OFFICIAL_HOLIDAY', 'COMPANY_HOLIDAY', 'INTERNAL_EVENT', 'REMINDER', 'OTHER');

CREATE TABLE "security_instant_report_types" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_instant_report_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_shift_log_entries" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "reportTypeId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "status" "SecurityShiftLogStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedBy" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  CONSTRAINT "security_shift_log_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_patrol_sessions" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "status" "SecurityPatrolStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "description" TEXT,
  CONSTRAINT "security_patrol_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sabalan_calendar_entries" (
  "id" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "isHoliday" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "eventType" "SabalanCalendarEventType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sabalan_calendar_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "security_instant_report_types_name_key" ON "security_instant_report_types"("name");
CREATE INDEX "security_instant_report_types_isActive_displayOrder_idx" ON "security_instant_report_types"("isActive", "displayOrder");
CREATE UNIQUE INDEX "security_shift_log_entries_sessionId_rowNumber_key" ON "security_shift_log_entries"("sessionId", "rowNumber");
CREATE INDEX "security_shift_log_entries_sessionId_createdAt_idx" ON "security_shift_log_entries"("sessionId", "createdAt");
CREATE INDEX "security_shift_log_entries_reportTypeId_idx" ON "security_shift_log_entries"("reportTypeId");
CREATE INDEX "security_shift_log_entries_status_idx" ON "security_shift_log_entries"("status");
CREATE INDEX "security_patrol_sessions_sessionId_startedAt_idx" ON "security_patrol_sessions"("sessionId", "startedAt");
CREATE INDEX "security_patrol_sessions_personnelId_status_idx" ON "security_patrol_sessions"("personnelId", "status");
CREATE INDEX "sabalan_calendar_entries_date_idx" ON "sabalan_calendar_entries"("date");
CREATE INDEX "sabalan_calendar_entries_isHoliday_idx" ON "sabalan_calendar_entries"("isHoliday");
CREATE INDEX "sabalan_calendar_entries_isActive_idx" ON "sabalan_calendar_entries"("isActive");

ALTER TABLE "security_shift_log_entries" ADD CONSTRAINT "security_shift_log_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "security_shift_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_shift_log_entries" ADD CONSTRAINT "security_shift_log_entries_reportTypeId_fkey" FOREIGN KEY ("reportTypeId") REFERENCES "security_instant_report_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_patrol_sessions" ADD CONSTRAINT "security_patrol_sessions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "security_shift_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_patrol_sessions" ADD CONSTRAINT "security_patrol_sessions_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "security_personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
