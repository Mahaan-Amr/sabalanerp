-- Phase 1 HR foundation: organization, jobs, positions, employment periods and assignments.
ALTER TABLE "personnel" ADD COLUMN "nationalCode" TEXT;
ALTER TABLE "personnel" ADD COLUMN "employeeNumber" TEXT;

CREATE UNIQUE INDEX "personnel_nationalCode_key" ON "personnel"("nationalCode");
CREATE UNIQUE INDEX "personnel_employeeNumber_key" ON "personnel"("employeeNumber");

CREATE TYPE "HrOrganizationalUnitType" AS ENUM ('COMPANY', 'DIVISION', 'DEPARTMENT', 'SECTION', 'TEAM');
CREATE TYPE "HrEmploymentStatus" AS ENUM ('PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED');
CREATE TYPE "HrAssignmentType" AS ENUM ('PRIMARY', 'SECONDARY', 'ACTING');

CREATE TABLE "hr_organizational_units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "HrOrganizationalUnitType" NOT NULL,
    "parentId" TEXT,
    "legacyDepartmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_organizational_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_workplaces" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_workplaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_cost_centers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_jobs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "responsibilities" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_positions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "organizationalUnitId" TEXT NOT NULL,
    "workplaceId" TEXT,
    "costCenterId" TEXT,
    "supervisorPositionId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_positions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_employment_relationships" (
    "id" TEXT NOT NULL,
    "personnelId" TEXT NOT NULL,
    "status" "HrEmploymentStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "originalStartDate" TIMESTAMP(3),
    "startDateVerified" BOOLEAN NOT NULL DEFAULT false,
    "endReason" TEXT,
    "sourceSystem" TEXT,
    "sourceId" TEXT,
    "migratedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_employment_relationships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hr_employment_assignments" (
    "id" TEXT NOT NULL,
    "employmentRelationshipId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "type" "HrAssignmentType" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "organizationalUnitId" TEXT,
    "workplaceId" TEXT,
    "costCenterId" TEXT,
    "responsibleSupervisorAssignmentId" TEXT,
    "scheduleContributing" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_employment_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_organizational_units_code_key" ON "hr_organizational_units"("code");
CREATE UNIQUE INDEX "hr_organizational_units_legacyDepartmentId_key" ON "hr_organizational_units"("legacyDepartmentId");
CREATE INDEX "hr_organizational_units_parentId_isActive_idx" ON "hr_organizational_units"("parentId", "isActive");
CREATE UNIQUE INDEX "hr_workplaces_code_key" ON "hr_workplaces"("code");
CREATE UNIQUE INDEX "hr_cost_centers_code_key" ON "hr_cost_centers"("code");
CREATE UNIQUE INDEX "hr_jobs_code_key" ON "hr_jobs"("code");
CREATE UNIQUE INDEX "hr_positions_code_key" ON "hr_positions"("code");
CREATE INDEX "hr_positions_organizationalUnitId_isActive_idx" ON "hr_positions"("organizationalUnitId", "isActive");
CREATE INDEX "hr_positions_jobId_isActive_idx" ON "hr_positions"("jobId", "isActive");
CREATE INDEX "hr_positions_supervisorPositionId_idx" ON "hr_positions"("supervisorPositionId");
CREATE UNIQUE INDEX "hr_employment_relationships_sourceSystem_sourceId_key" ON "hr_employment_relationships"("sourceSystem", "sourceId");
CREATE INDEX "hr_employment_relationships_personnelId_status_effectiveFrom_effectiveTo_idx" ON "hr_employment_relationships"("personnelId", "status", "effectiveFrom", "effectiveTo");
CREATE INDEX "hr_employment_assignments_employmentRelationshipId_type_effectiveFrom_effectiveTo_idx" ON "hr_employment_assignments"("employmentRelationshipId", "type", "effectiveFrom", "effectiveTo");
CREATE INDEX "hr_employment_assignments_positionId_effectiveFrom_effectiveTo_idx" ON "hr_employment_assignments"("positionId", "effectiveFrom", "effectiveTo");
CREATE INDEX "hr_employment_assignments_responsibleSupervisorAssignmentId_idx" ON "hr_employment_assignments"("responsibleSupervisorAssignmentId");

ALTER TABLE "hr_organizational_units" ADD CONSTRAINT "hr_organizational_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "hr_organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "hr_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_organizationalUnitId_fkey" FOREIGN KEY ("organizationalUnitId") REFERENCES "hr_organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "hr_workplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "hr_cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_positions" ADD CONSTRAINT "hr_positions_supervisorPositionId_fkey" FOREIGN KEY ("supervisorPositionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_relationships" ADD CONSTRAINT "hr_employment_relationships_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_employmentRelationshipId_fkey" FOREIGN KEY ("employmentRelationshipId") REFERENCES "hr_employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_organizationalUnitId_fkey" FOREIGN KEY ("organizationalUnitId") REFERENCES "hr_organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_workplaceId_fkey" FOREIGN KEY ("workplaceId") REFERENCES "hr_workplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "hr_cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_responsibleSupervisorAssignmentId_fkey" FOREIGN KEY ("responsibleSupervisorAssignmentId") REFERENCES "hr_employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
