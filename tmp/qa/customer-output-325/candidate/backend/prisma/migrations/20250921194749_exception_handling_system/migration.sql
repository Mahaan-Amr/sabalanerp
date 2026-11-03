-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('MISSION', 'HOURLY_LEAVE', 'SICK_LEAVE', 'VACATION', 'ABSENCE', 'EMERGENCY_LEAVE', 'PERSONAL_LEAVE');

-- CreateTable
CREATE TABLE "exception_requests" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exceptionType" "ExceptionType" NOT NULL,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "duration" INTEGER,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "emergencyContact" TEXT,
    "medicalCertificate" TEXT,
    "approvedBy" TEXT,
    "rejectedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exception_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_assignments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "missionType" TEXT NOT NULL,
    "missionLocation" TEXT NOT NULL,
    "missionPurpose" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mission_assignments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "exception_requests" ADD CONSTRAINT "exception_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_requests" ADD CONSTRAINT "exception_requests_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exception_requests" ADD CONSTRAINT "exception_requests_rejectedBy_fkey" FOREIGN KEY ("rejectedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_assignments" ADD CONSTRAINT "mission_assignments_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
