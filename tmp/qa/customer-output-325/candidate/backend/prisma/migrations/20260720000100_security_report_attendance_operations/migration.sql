BEGIN;

-- Refuse malformed legacy values before making any schema change. Localized Persian
-- and Arabic digits are accepted and normalized only while copying historical data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "attendance_records"
    WHERE
      ("entryTime" IS NOT NULL AND translate(btrim("entryTime"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$')
      OR
      ("exitTime" IS NOT NULL AND translate(btrim("exitTime"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$')
  ) THEN
    RAISE EXCEPTION 'Invalid legacy attendance time values; migration made no changes';
  END IF;
END $$;

-- Category-driven instant reports
ALTER TABLE "security_instant_report_categories"
  ADD COLUMN IF NOT EXISTS "useReportTypes" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "useRelatedPersonnel" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "security_instant_report_types"
  ADD COLUMN IF NOT EXISTS "useRelatedPersonnel" BOOLEAN NOT NULL DEFAULT true;

UPDATE "security_instant_report_categories"
SET "useReportTypes" = false, "useRelatedPersonnel" = false
WHERE replace("name", ' ', '') IN ('وقایعورویدادها', 'پیشنهاداتوانتقادات');

ALTER TABLE "security_shift_log_entries"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT,
  ADD COLUMN IF NOT EXISTS "categoryNameSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "reportTypeNameSnapshot" TEXT;

UPDATE "security_shift_log_entries" entry
SET
  "categoryId" = report_type."categoryId",
  "categoryNameSnapshot" = category."name",
  "reportTypeNameSnapshot" = report_type."name"
FROM "security_instant_report_types" report_type
JOIN "security_instant_report_categories" category ON category."id" = report_type."categoryId"
WHERE entry."reportTypeId" = report_type."id";

ALTER TABLE "security_shift_log_entries"
  ALTER COLUMN "categoryId" SET NOT NULL,
  ALTER COLUMN "categoryNameSnapshot" SET NOT NULL,
  ALTER COLUMN "reportTypeId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "security_shift_log_entries_categoryId_idx" ON "security_shift_log_entries"("categoryId");
DO $$ BEGIN
  ALTER TABLE "security_shift_log_entries"
    ADD CONSTRAINT "security_shift_log_entries_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "security_instant_report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Multiple physical-presence intervals and retirement of registrar shift from company attendance
ALTER TABLE "attendance_records" ALTER COLUMN "securityPersonnelId" DROP NOT NULL;
ALTER TABLE "attendance_records" ALTER COLUMN "shiftId" DROP NOT NULL;
ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "attendance_records_securityPersonnelId_fkey";
ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "attendance_records_shiftId_fkey";
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_securityPersonnelId_fkey"
  FOREIGN KEY ("securityPersonnelId") REFERENCES "security_personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  CREATE TYPE "AttendanceIntervalStatus" AS ENUM ('ACTIVE', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "attendance_intervals" (
  "id" TEXT NOT NULL,
  "attendanceRecordId" TEXT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL,
  "exitedAt" TIMESTAMP(3),
  "entryRecordedBy" TEXT NOT NULL,
  "exitRecordedBy" TEXT,
  "entryReason" TEXT,
  "exitReason" TEXT,
  "status" "AttendanceIntervalStatus" NOT NULL DEFAULT 'ACTIVE',
  "voidReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_intervals_pkey" PRIMARY KEY ("id")
);

WITH normalized_records AS (
  SELECT
    record.*,
    translate(btrim(record."entryTime"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789') AS "normalizedEntryTime",
    CASE WHEN record."exitTime" IS NULL THEN NULL
      ELSE translate(btrim(record."exitTime"), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
    END AS "normalizedExitTime"
  FROM "attendance_records" record
)
INSERT INTO "attendance_intervals" (
  "id", "attendanceRecordId", "enteredAt", "exitedAt", "entryRecordedBy", "exitRecordedBy", "createdAt", "updatedAt"
)
SELECT
  'migrated-' || record."id",
  record."id",
  date_trunc('day', record."date") + record."normalizedEntryTime"::time - interval '3 hours 30 minutes',
  CASE
    WHEN record."normalizedExitTime" IS NULL THEN NULL
    WHEN record."normalizedExitTime"::time < record."normalizedEntryTime"::time
      THEN date_trunc('day', record."date") + interval '1 day' + record."normalizedExitTime"::time - interval '3 hours 30 minutes'
    ELSE date_trunc('day', record."date") + record."normalizedExitTime"::time - interval '3 hours 30 minutes'
  END,
  personnel."userId",
  CASE WHEN record."exitTime" IS NULL THEN NULL ELSE personnel."userId" END,
  record."createdAt",
  record."updatedAt"
FROM normalized_records record
JOIN "security_personnel" personnel ON personnel."id" = record."securityPersonnelId"
WHERE record."entryTime" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX IF NOT EXISTS "attendance_intervals_attendanceRecordId_enteredAt_idx" ON "attendance_intervals"("attendanceRecordId", "enteredAt");
CREATE INDEX IF NOT EXISTS "attendance_intervals_status_enteredAt_idx" ON "attendance_intervals"("status", "enteredAt");
DO $$ BEGIN
  ALTER TABLE "attendance_intervals"
    ADD CONSTRAINT "attendance_intervals_attendanceRecordId_fkey"
    FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "attendance_intervals"
    ADD CONSTRAINT "attendance_intervals_entryRecordedBy_fkey"
    FOREIGN KEY ("entryRecordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "attendance_intervals"
    ADD CONSTRAINT "attendance_intervals_exitRecordedBy_fkey"
    FOREIGN KEY ("exitRecordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "attendance_interval_audits" (
  "id" TEXT NOT NULL,
  "intervalId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeData" JSONB NOT NULL,
  "afterData" JSONB,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_interval_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "attendance_interval_audits_intervalId_createdAt_idx" ON "attendance_interval_audits"("intervalId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "attendance_interval_audits"
    ADD CONSTRAINT "attendance_interval_audits_intervalId_fkey"
    FOREIGN KEY ("intervalId") REFERENCES "attendance_intervals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "attendance_interval_audits"
    ADD CONSTRAINT "attendance_interval_audits_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Personnel-based Security exceptions and missions with an append-only audit trail
ALTER TABLE "exception_requests" ADD COLUMN IF NOT EXISTS "personnelId" TEXT;
ALTER TABLE "exception_requests" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "exception_requests" DROP CONSTRAINT IF EXISTS "exception_requests_employeeId_fkey";
ALTER TABLE "exception_requests"
  ADD CONSTRAINT "exception_requests_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "exception_requests" request
SET "personnelId" = employee."personnelId"
FROM "users" employee
WHERE request."employeeId" = employee."id" AND employee."personnelId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "exception_requests_personnelId_status_startDate_idx" ON "exception_requests"("personnelId", "status", "startDate");
DO $$ BEGIN
  ALTER TABLE "exception_requests"
    ADD CONSTRAINT "exception_requests_personnelId_fkey"
    FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "mission_assignments"
  ADD COLUMN IF NOT EXISTS "personnelId" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE "mission_assignments" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "mission_assignments" DROP CONSTRAINT IF EXISTS "mission_assignments_employeeId_fkey";
ALTER TABLE "mission_assignments"
  ADD CONSTRAINT "mission_assignments_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "mission_assignments" mission
SET "personnelId" = employee."personnelId"
FROM "users" employee
WHERE mission."employeeId" = employee."id" AND employee."personnelId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "mission_assignments_personnelId_status_startDate_idx" ON "mission_assignments"("personnelId", "status", "startDate");
DO $$ BEGIN
  ALTER TABLE "mission_assignments"
    ADD CONSTRAINT "mission_assignments_personnelId_fkey"
    FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "security_attendance_workflow_events" (
  "id" TEXT NOT NULL,
  "exceptionId" TEXT,
  "missionId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "beforeData" JSONB,
  "afterData" JSONB,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_attendance_workflow_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "security_attendance_workflow_events_exceptionId_createdAt_idx" ON "security_attendance_workflow_events"("exceptionId", "createdAt");
CREATE INDEX IF NOT EXISTS "security_attendance_workflow_events_missionId_createdAt_idx" ON "security_attendance_workflow_events"("missionId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "security_attendance_workflow_events"
    ADD CONSTRAINT "security_attendance_workflow_events_exceptionId_fkey"
    FOREIGN KEY ("exceptionId") REFERENCES "exception_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "security_attendance_workflow_events"
    ADD CONSTRAINT "security_attendance_workflow_events_missionId_fkey"
    FOREIGN KEY ("missionId") REFERENCES "mission_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "security_attendance_workflow_events"
    ADD CONSTRAINT "security_attendance_workflow_events_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
