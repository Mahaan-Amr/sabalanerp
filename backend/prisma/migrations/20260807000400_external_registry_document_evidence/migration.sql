CREATE TABLE "external_driver_documents" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "external_driver_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_vehicle_documents" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy" TEXT NOT NULL,
  CONSTRAINT "external_vehicle_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_driver_documents_driverId_documentType_recordedAt_idx" ON "external_driver_documents"("driverId", "documentType", "recordedAt");
CREATE INDEX "external_vehicle_documents_vehicleId_documentType_recordedAt_idx" ON "external_vehicle_documents"("vehicleId", "documentType", "recordedAt");
ALTER TABLE "external_driver_documents" ADD CONSTRAINT "external_driver_documents_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "external_vehicle_documents" ADD CONSTRAINT "external_vehicle_documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "external_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
