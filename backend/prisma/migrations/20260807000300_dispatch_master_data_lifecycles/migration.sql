CREATE TYPE "InternalDriverProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "CompanyVehicleLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OUT_OF_SERVICE', 'ARCHIVED');
CREATE TYPE "ExternalRegistryLifecycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RESTRICTED', 'ARCHIVED');

ALTER TABLE "internal_driver_profiles" ALTER COLUMN "licenceNumber" DROP NOT NULL;
ALTER TABLE "internal_driver_profiles"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "InternalDriverProfileStatus"
  USING (CASE "status"::text WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'ARCHIVED' END)::"InternalDriverProfileStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "company_vehicles"
  ADD COLUMN "statusEffectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusRecordedBy" TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "CompanyVehicleLifecycleStatus"
  USING (CASE "status"::text WHEN 'IN_SERVICE' THEN 'ACTIVE' WHEN 'OUT_OF_SERVICE' THEN 'OUT_OF_SERVICE' ELSE 'ARCHIVED' END)::"CompanyVehicleLifecycleStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "external_drivers"
  ADD COLUMN "statusEffectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusRecordedBy" TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ExternalRegistryLifecycleStatus"
  USING (CASE "status"::text WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'SUSPENDED' THEN 'RESTRICTED' ELSE 'ARCHIVED' END)::"ExternalRegistryLifecycleStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "external_vehicles"
  ADD COLUMN "statusEffectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusRecordedBy" TEXT,
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ExternalRegistryLifecycleStatus"
  USING (CASE "status"::text WHEN 'IN_SERVICE' THEN 'ACTIVE' WHEN 'OUT_OF_SERVICE' THEN 'RESTRICTED' ELSE 'ARCHIVED' END)::"ExternalRegistryLifecycleStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "dispatch_master_data_audits" ADD COLUMN "ownerScope" TEXT;
UPDATE "dispatch_master_data_audits"
SET "ownerScope" = CASE
  WHEN "subjectType" = 'COMPANY_VEHICLE' THEN 'VEHICLE_OPERATIONS'
  WHEN "subjectType" IN ('EXTERNAL_DRIVER', 'EXTERNAL_VEHICLE') THEN 'GUARD'
  WHEN "eventType" LIKE 'ELIGIBILITY_%' OR "eventType" = 'INTERNAL_DRIVER_DESIGNATED' THEN 'HR'
  ELSE 'VEHICLE_OPERATIONS'
END;
ALTER TABLE "dispatch_master_data_audits" ALTER COLUMN "ownerScope" SET NOT NULL;

DROP TYPE "DriverOperationalStatus";
DROP TYPE "FleetVehicleStatus";
