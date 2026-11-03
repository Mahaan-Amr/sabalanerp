CREATE TABLE IF NOT EXISTS "security_attendance_roster_memberships" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "endedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "security_attendance_roster_memberships_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "security_attendance_roster_memberships_personnelId_effectiveFrom_effectiveTo_idx"
  ON "security_attendance_roster_memberships"("personnelId", "effectiveFrom", "effectiveTo");

CREATE INDEX IF NOT EXISTS "security_attendance_roster_memberships_effectiveFrom_effectiveTo_idx"
  ON "security_attendance_roster_memberships"("effectiveFrom", "effectiveTo");

ALTER TABLE "security_attendance_roster_memberships"
  ADD CONSTRAINT "security_attendance_roster_memberships_personnelId_fkey"
  FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "security_attendance_roster_memberships"
  ADD CONSTRAINT "security_attendance_roster_memberships_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "security_attendance_roster_memberships"
  ADD CONSTRAINT "security_attendance_roster_memberships_endedBy_fkey"
  FOREIGN KEY ("endedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "security_attendance_roster_memberships" (
  "id",
  "personnelId",
  "effectiveFrom",
  "createdBy",
  "createdAt",
  "updatedAt"
)
SELECT
  'sar_' || md5(p."id" || clock_timestamp()::text),
  p."id",
  CURRENT_DATE,
  seed_user."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "personnel" p
CROSS JOIN LATERAL (
  SELECT u."id"
  FROM "users" u
  ORDER BY
    CASE u."role" WHEN 'ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END,
    u."createdAt" ASC
  LIMIT 1
) seed_user
WHERE p."isActive" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "security_attendance_roster_memberships" existing
    WHERE existing."personnelId" = p."id"
  );
