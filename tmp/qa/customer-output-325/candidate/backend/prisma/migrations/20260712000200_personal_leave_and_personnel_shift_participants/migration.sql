-- Add personal leave metadata to the existing exception request workflow.
ALTER TYPE "ExceptionStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "exception_requests"
  ADD COLUMN IF NOT EXISTS "requestedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "leaveType" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

UPDATE "exception_requests"
SET "requestedBy" = "employeeId"
WHERE "requestedBy" IS NULL;

CREATE INDEX IF NOT EXISTS "exception_requests_requestedBy_idx" ON "exception_requests"("requestedBy");
CREATE INDEX IF NOT EXISTS "exception_requests_status_startDate_idx" ON "exception_requests"("status", "startDate");

ALTER TABLE "exception_requests"
  ADD CONSTRAINT "exception_requests_requestedBy_fkey"
  FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "exception_requests"
  ADD CONSTRAINT "exception_requests_cancelledBy_fkey"
  FOREIGN KEY ("cancelledBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New shift-log participants point to organizational personnel; old user-based
-- participants remain valid for historical compatibility.
ALTER TABLE "security_shift_log_participants"
  ALTER COLUMN "userId" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "personnelId" TEXT;

UPDATE "security_shift_log_participants" participant
SET "personnelId" = "users"."personnelId"
FROM "users"
WHERE participant."userId" = "users"."id"
  AND participant."personnelId" IS NULL
  AND "users"."personnelId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "security_shift_log_participants_entryId_personnelId_key"
  ON "security_shift_log_participants"("entryId", "personnelId");

CREATE INDEX IF NOT EXISTS "security_shift_log_participants_personnelId_idx"
  ON "security_shift_log_participants"("personnelId");

ALTER TABLE "security_shift_log_participants"
  ADD CONSTRAINT "security_shift_log_participants_personnelId_fkey"
  FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
