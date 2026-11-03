ALTER TABLE "security_vehicle_pairs"
  ADD COLUMN "homeAddress" TEXT,
  ADD COLUMN "relativePhone" TEXT,
  ADD COLUMN "informationGraceEndsAt" TIMESTAMP(3);

UPDATE "security_vehicle_pairs"
SET "informationGraceEndsAt" = CURRENT_TIMESTAMP + INTERVAL '30 days';

CREATE TYPE "SecurityVehiclePairPhotoCategory" AS ENUM ('DRIVER_LICENSE', 'VEHICLE_CARD', 'DRIVER_PHOTO');

CREATE TABLE "security_vehicle_pair_photos" (
  "id" TEXT NOT NULL,
  "vehiclePairId" TEXT NOT NULL,
  "category" "SecurityVehiclePairPhotoCategory" NOT NULL,
  "storageName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_vehicle_pair_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_vehicle_pair_photos_vehiclePairId_fkey" FOREIGN KEY ("vehiclePairId") REFERENCES "security_vehicle_pairs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "security_vehicle_pair_photos_vehiclePairId_idx" ON "security_vehicle_pair_photos"("vehiclePairId");
CREATE INDEX "security_vehicle_pair_photos_category_idx" ON "security_vehicle_pair_photos"("category");

ALTER TABLE "accounting_contract_flags"
  ADD COLUMN "resolutionNote" TEXT,
  ADD COLUMN "cancelledBy" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancellationReason" TEXT;
