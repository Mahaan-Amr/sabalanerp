-- AlterTable
ALTER TABLE "external_drivers" ADD COLUMN     "licenceClass" TEXT,
ADD COLUMN     "licenceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "licenceNumber" TEXT;

-- AlterTable
ALTER TABLE "external_vehicles" ADD COLUMN     "fleetCode" TEXT,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "manufactureYear" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "vin" TEXT;

-- AlterTable
ALTER TABLE "driver_biometric_enrollments" ADD COLUMN     "externalDriverId" TEXT,
ALTER COLUMN "personnelId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "external_driver_vehicle_assignments" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT NOT NULL,

    CONSTRAINT "external_driver_vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_driver_vehicle_assignment_plans" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "action" TEXT NOT NULL DEFAULT 'ASSIGN',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "blockedReason" TEXT,
    "expectedAssignmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_driver_vehicle_assignment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_driver_vehicle_assignments_driverId_effectiveFrom_idx" ON "external_driver_vehicle_assignments"("driverId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "external_driver_vehicle_assignments_vehicleId_effectiveFrom_idx" ON "external_driver_vehicle_assignments"("vehicleId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "external_driver_vehicle_assignment_plans_status_effectiveFr_idx" ON "external_driver_vehicle_assignment_plans"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "external_driver_vehicle_assignment_plans_driverId_status_idx" ON "external_driver_vehicle_assignment_plans"("driverId", "status");

-- CreateIndex
CREATE INDEX "external_driver_vehicle_assignment_plans_vehicleId_status_idx" ON "external_driver_vehicle_assignment_plans"("vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_vehicles_fleetCode_key" ON "external_vehicles"("fleetCode");

-- CreateIndex
CREATE UNIQUE INDEX "external_vehicles_vin_key" ON "external_vehicles"("vin");

-- CreateIndex
CREATE INDEX "driver_biometric_enrollments_externalDriverId_status_idx" ON "driver_biometric_enrollments"("externalDriverId", "status");

-- AddForeignKey
ALTER TABLE "external_driver_vehicle_assignments" ADD CONSTRAINT "external_driver_vehicle_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_driver_vehicle_assignments" ADD CONSTRAINT "external_driver_vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "external_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_driver_vehicle_assignment_plans" ADD CONSTRAINT "external_driver_vehicle_assignment_plans_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_driver_vehicle_assignment_plans" ADD CONSTRAINT "external_driver_vehicle_assignment_plans_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "external_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_driver_vehicle_assignment_plans" ADD CONSTRAINT "external_driver_vehicle_assignment_plans_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "external_driver_vehicle_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_biometric_enrollments" ADD CONSTRAINT "driver_biometric_enrollments_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve legacy internal identities; every new enrollment belongs to exactly one source.
ALTER TABLE "driver_biometric_enrollments" ADD CONSTRAINT "biometric_subject_exactly_one"
  CHECK (("personnelId" IS NOT NULL)::int + ("externalDriverId" IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX "one_active_external_biometric" ON "driver_biometric_enrollments" ("externalDriverId") WHERE status = 'ACTIVE';
ALTER TABLE "external_driver_vehicle_assignments" ADD CONSTRAINT "external_assignment_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "external_driver_vehicle_assignments"
  ADD CONSTRAINT "external_assignment_driver_no_overlap" EXCLUDE USING gist ("driverId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&),
  ADD CONSTRAINT "external_assignment_vehicle_no_overlap" EXCLUDE USING gist ("vehicleId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&);
ALTER TABLE "external_driver_vehicle_assignment_plans"
  ADD CONSTRAINT "external_plan_action" CHECK ("action" IN ('ASSIGN','END')),
  ADD CONSTRAINT "external_plan_status" CHECK ("status" IN ('PLANNED','NEEDS_ATTENTION','APPLIED','CANCELLED')),
  ADD CONSTRAINT "external_plan_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
