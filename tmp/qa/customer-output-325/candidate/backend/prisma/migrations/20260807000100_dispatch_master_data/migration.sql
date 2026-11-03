CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "InternalDriverEligibilityStatus" AS ENUM ('ELIGIBLE', 'SUSPENDED', 'ENDED');
CREATE TYPE "DriverOperationalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'RETIRED');
CREATE TYPE "FleetVehicleStatus" AS ENUM ('IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED');

CREATE TABLE "internal_driver_profiles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "personnelId" TEXT NOT NULL UNIQUE,
  "licenceNumber" TEXT NOT NULL UNIQUE,
  "licenceClass" TEXT,
  "licenceExpiresAt" TIMESTAMP(3),
  "status" "DriverOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "internal_driver_profiles_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "internal_driver_eligibility_periods" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "status" "InternalDriverEligibilityStatus" NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "internal_driver_eligibility_periods_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "internal_driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "internal_driver_eligibility_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "internal_driver_eligibility_no_overlap" EXCLUDE USING gist ("driverId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&)
);

CREATE TABLE "company_vehicles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fleetCode" TEXT NOT NULL UNIQUE,
  "vehicleType" TEXT NOT NULL,
  "make" TEXT,
  "model" TEXT,
  "vin" TEXT UNIQUE,
  "status" "FleetVehicleStatus" NOT NULL DEFAULT 'IN_SERVICE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL
);

CREATE TABLE "company_vehicle_plates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vehicleId" TEXT NOT NULL,
  "plate" TEXT NOT NULL,
  "normalizedPlate" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "company_vehicle_plates_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "company_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "company_vehicle_plate_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "company_vehicle_plate_vehicle_no_overlap" EXCLUDE USING gist ("vehicleId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&),
  CONSTRAINT "company_vehicle_plate_value_no_overlap" EXCLUDE USING gist ("normalizedPlate" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&)
);

CREATE TABLE "driver_vehicle_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "driverId" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "driver_vehicle_assignments_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "internal_driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "driver_vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "company_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "driver_vehicle_assignment_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "driver_vehicle_assignment_driver_no_overlap" EXCLUDE USING gist ("driverId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&),
  CONSTRAINT "driver_vehicle_assignment_vehicle_no_overlap" EXCLUDE USING gist ("vehicleId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&)
);

CREATE TABLE "external_drivers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "nationalCode" TEXT NOT NULL UNIQUE,
  "phone" TEXT NOT NULL,
  "status" "DriverOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL
);

CREATE TABLE "external_vehicles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vehicleType" TEXT NOT NULL,
  "status" "FleetVehicleStatus" NOT NULL DEFAULT 'IN_SERVICE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL
);

CREATE TABLE "external_vehicle_plates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vehicleId" TEXT NOT NULL,
  "plate" TEXT NOT NULL,
  "normalizedPlate" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "external_vehicle_plates_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "external_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "external_vehicle_plate_valid_period" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "external_vehicle_plate_vehicle_no_overlap" EXCLUDE USING gist ("vehicleId" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&),
  CONSTRAINT "external_vehicle_plate_value_no_overlap" EXCLUDE USING gist ("normalizedPlate" WITH =, tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp), '[)') WITH &&)
);

CREATE TABLE "external_driver_personnel_continuity_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "externalDriverId" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "external_driver_personnel_continuity_links_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "external_driver_personnel_continuity_links_identity_key" UNIQUE ("externalDriverId", "personnelId")
);

CREATE TABLE "dispatch_master_data_audits" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL UNIQUE
);

CREATE INDEX "internal_driver_profiles_status_idx" ON "internal_driver_profiles"("status");
CREATE INDEX "internal_driver_eligibility_periods_driverId_effectiveFrom_idx" ON "internal_driver_eligibility_periods"("driverId", "effectiveFrom");
CREATE INDEX "internal_driver_eligibility_periods_status_effectiveFrom_effectiveTo_idx" ON "internal_driver_eligibility_periods"("status", "effectiveFrom", "effectiveTo");
CREATE INDEX "company_vehicles_status_idx" ON "company_vehicles"("status");
CREATE INDEX "company_vehicle_plates_vehicleId_effectiveFrom_idx" ON "company_vehicle_plates"("vehicleId", "effectiveFrom");
CREATE INDEX "company_vehicle_plates_normalizedPlate_effectiveFrom_effectiveTo_idx" ON "company_vehicle_plates"("normalizedPlate", "effectiveFrom", "effectiveTo");
CREATE INDEX "driver_vehicle_assignments_driverId_effectiveFrom_idx" ON "driver_vehicle_assignments"("driverId", "effectiveFrom");
CREATE INDEX "driver_vehicle_assignments_vehicleId_effectiveFrom_idx" ON "driver_vehicle_assignments"("vehicleId", "effectiveFrom");
CREATE INDEX "external_drivers_status_idx" ON "external_drivers"("status");
CREATE INDEX "external_vehicles_status_idx" ON "external_vehicles"("status");
CREATE INDEX "external_vehicle_plates_vehicleId_effectiveFrom_idx" ON "external_vehicle_plates"("vehicleId", "effectiveFrom");
CREATE INDEX "external_vehicle_plates_normalizedPlate_effectiveFrom_effectiveTo_idx" ON "external_vehicle_plates"("normalizedPlate", "effectiveFrom", "effectiveTo");
CREATE INDEX "external_driver_personnel_continuity_links_personnelId_idx" ON "external_driver_personnel_continuity_links"("personnelId");
CREATE INDEX "dispatch_master_data_audits_subjectType_subjectId_recordedAt_idx" ON "dispatch_master_data_audits"("subjectType", "subjectId", "recordedAt");

CREATE OR REPLACE FUNCTION assert_canonical_plate_available() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."normalizedPlate"));
  IF TG_TABLE_NAME = 'company_vehicle_plates' AND EXISTS (
    SELECT 1 FROM "external_vehicle_plates" other
    WHERE other."normalizedPlate" = NEW."normalizedPlate"
      AND tsrange(other."effectiveFrom", COALESCE(other."effectiveTo", 'infinity'::timestamp), '[)')
          && tsrange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::timestamp), '[)')
  ) THEN RAISE EXCEPTION 'Plate is already effective in the external registry' USING ERRCODE = '23P01';
  END IF;
  IF TG_TABLE_NAME = 'external_vehicle_plates' AND EXISTS (
    SELECT 1 FROM "company_vehicle_plates" other
    WHERE other."normalizedPlate" = NEW."normalizedPlate"
      AND tsrange(other."effectiveFrom", COALESCE(other."effectiveTo", 'infinity'::timestamp), '[)')
          && tsrange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::timestamp), '[)')
  ) THEN RAISE EXCEPTION 'Plate is already effective in the company registry' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "company_vehicle_plate_cross_registry_guard" BEFORE INSERT OR UPDATE ON "company_vehicle_plates" FOR EACH ROW EXECUTE FUNCTION assert_canonical_plate_available();
CREATE TRIGGER "external_vehicle_plate_cross_registry_guard" BEFORE INSERT OR UPDATE ON "external_vehicle_plates" FOR EACH ROW EXECUTE FUNCTION assert_canonical_plate_available();
