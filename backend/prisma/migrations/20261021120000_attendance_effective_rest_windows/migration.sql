-- Opt-in, effective-dated policy; intentionally no operational attendance or entitlement backfill.
CREATE TABLE "attendance_rest_policies" (
 "id" TEXT PRIMARY KEY, "effectiveFrom" TIMESTAMP(3) NOT NULL UNIQUE,
 "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "rest_policy_clock" CHECK ("startTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND "startTime" <> "endTime")
);
CREATE TABLE "attendance_rest_assignments" (
 "id" TEXT PRIMARY KEY, "personnelId" TEXT NOT NULL REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "effectiveFrom" TIMESTAMP(3) NOT NULL, "hasRest" BOOLEAN NOT NULL,
 "createdBy" TEXT NOT NULL, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("personnelId", "effectiveFrom")
);
CREATE TABLE "attendance_absence_decisions" (
 "id" TEXT PRIMARY KEY, "personnelId" TEXT NOT NULL REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "date" TIMESTAMP(3) NOT NULL, "evidenceHash" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "evidence" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("personnelId", "date", "evidenceHash")
);
CREATE INDEX "attendance_absence_decisions_date_idx" ON "attendance_absence_decisions"("date");
