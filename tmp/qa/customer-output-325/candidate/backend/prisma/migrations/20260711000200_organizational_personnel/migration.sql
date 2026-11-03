CREATE TABLE "personnel" (
  "id" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "departmentId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personnel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personnel_isActive_departmentId_idx" ON "personnel"("isActive", "departmentId");
CREATE INDEX "personnel_lastName_firstName_idx" ON "personnel"("lastName", "firstName");

ALTER TABLE "personnel" ADD CONSTRAINT "personnel_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "personnelId" TEXT;
CREATE UNIQUE INDEX "users_personnelId_key" ON "users"("personnelId");

INSERT INTO "personnel" ("id", "firstName", "lastName", "departmentId", "isActive", "createdAt", "updatedAt")
SELECT 'personnel_' || "id", "firstName", "lastName", "departmentId", "isActive", "createdAt", "updatedAt"
FROM "users";

UPDATE "users"
SET "personnelId" = 'personnel_' || "id"
WHERE "personnelId" IS NULL;

ALTER TABLE "users" ADD CONSTRAINT "users_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_records" ADD COLUMN "personnelId" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "personnelFirstName" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "personnelLastName" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "departmentName" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN "departmentNamePersian" TEXT;

UPDATE "attendance_records" ar
SET
  "personnelId" = u."personnelId",
  "personnelFirstName" = u."firstName",
  "personnelLastName" = u."lastName",
  "departmentId" = d."id",
  "departmentName" = d."name",
  "departmentNamePersian" = d."namePersian"
FROM "users" u
LEFT JOIN "departments" d ON d."id" = u."departmentId"
WHERE ar."employeeId" = u."id";

ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "attendance_records_employeeId_fkey";
ALTER TABLE "attendance_records" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "attendance_records_personnelId_date_idx" ON "attendance_records"("personnelId", "date");
CREATE INDEX "attendance_records_employeeId_date_idx" ON "attendance_records"("employeeId", "date");
