CREATE TABLE "driver_vehicle_assignment_plans" (
  "id" TEXT PRIMARY KEY,
  "driverId" TEXT NOT NULL REFERENCES "internal_driver_profiles"("id") ON DELETE RESTRICT,
  "vehicleId" TEXT NOT NULL REFERENCES "company_vehicles"("id") ON DELETE RESTRICT,
  "assignmentId" TEXT REFERENCES "driver_vehicle_assignments"("id") ON DELETE RESTRICT,
  "action" TEXT NOT NULL DEFAULT 'ASSIGN' CHECK ("action" IN ('ASSIGN','END')),
  "status" TEXT NOT NULL DEFAULT 'PLANNED' CHECK ("status" IN ('PLANNED','NEEDS_ATTENTION','APPLIED','CANCELLED')),
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "blockedReason" TEXT,
  "expectedAssignmentIds" TEXT[] NOT NULL DEFAULT '{}',
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assignment_plan_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);
CREATE INDEX "driver_vehicle_assignment_plans_status_effectiveFrom_idx" ON "driver_vehicle_assignment_plans"("status", "effectiveFrom");
CREATE INDEX "driver_vehicle_assignment_plans_driverId_status_idx" ON "driver_vehicle_assignment_plans"("driverId", "status");
CREATE INDEX "driver_vehicle_assignment_plans_vehicleId_status_idx" ON "driver_vehicle_assignment_plans"("vehicleId", "status");
