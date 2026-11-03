CREATE TYPE "SecurityVehiclePlateKind" AS ENUM ('STANDARD', 'SPECIAL');
CREATE TYPE "SecurityDriverQueueTurnStatus" AS ENUM ('WAITING', 'RESERVED', 'DISPATCHED', 'OUT_OF_QUEUE');

ALTER TABLE "security_vehicle_pairs"
ADD COLUMN "vehiclePlateKind" "SecurityVehiclePlateKind" NOT NULL DEFAULT 'STANDARD';

UPDATE "security_vehicle_pairs" SET "vehiclePlateKind" = 'SPECIAL';

CREATE TABLE "security_driver_queue_turns" (
  "id" TEXT NOT NULL,
  "vehiclePairId" TEXT NOT NULL,
  "status" "SecurityDriverQueueTurnStatus" NOT NULL DEFAULT 'WAITING',
  "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enteredBy" TEXT NOT NULL,
  "reservedAt" TIMESTAMP(3),
  "reservedBy" TEXT,
  "reservedPosition" INTEGER,
  "loadingId" TEXT,
  "dispatchedAt" TIMESTAMP(3),
  "dispatchedBy" TEXT,
  "removedAt" TIMESTAMP(3),
  "removedBy" TEXT,
  "removalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "security_driver_queue_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_driver_queue_turns_vehiclePairId_fkey" FOREIGN KEY ("vehiclePairId") REFERENCES "security_vehicle_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "security_driver_queue_turns_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "security_driver_queue_turns_loadingId_key" ON "security_driver_queue_turns"("loadingId");
CREATE INDEX "security_driver_queue_turns_status_enteredAt_idx" ON "security_driver_queue_turns"("status", "enteredAt");
CREATE INDEX "security_driver_queue_turns_vehiclePairId_status_idx" ON "security_driver_queue_turns"("vehiclePairId", "status");
