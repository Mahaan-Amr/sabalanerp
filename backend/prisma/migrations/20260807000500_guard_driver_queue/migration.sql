CREATE TYPE "GuardDriverSource" AS ENUM ('INTERNAL', 'EXTERNAL');
CREATE TYPE "GuardDriverQueueTurnStatus" AS ENUM ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED', 'EXIT_RECORDED', 'CLOSED_WITHOUT_LOADING', 'VOIDED');

CREATE TABLE "guard_driver_queue_turns" (
  "id" TEXT NOT NULL,
  "driverSource" "GuardDriverSource" NOT NULL,
  "status" "GuardDriverQueueTurnStatus" NOT NULL DEFAULT 'WAITING_AT_GATE',
  "internalDriverId" TEXT,
  "externalDriverId" TEXT,
  "companyVehicleId" TEXT,
  "externalVehicleId" TEXT,
  "assignmentId" TEXT,
  "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "admittedBy" TEXT NOT NULL,
  "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "admissionSnapshot" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "availableAt" TIMESTAMP(3),
  "availableBy" TEXT,
  "loadingId" TEXT,
  "reservedAt" TIMESTAMP(3),
  "reservedBy" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "finalizedBy" TEXT,
  "exitedAt" TIMESTAMP(3),
  "exitedBy" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "closureReason" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidReason" TEXT,
  "replacementTurnId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guard_driver_queue_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guard_driver_queue_source_shape" CHECK (
    ("driverSource" = 'INTERNAL' AND "internalDriverId" IS NOT NULL AND "companyVehicleId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL)
    OR
    ("driverSource" = 'EXTERNAL' AND "externalDriverId" IS NOT NULL AND "externalVehicleId" IS NOT NULL AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL)
  )
);

CREATE TABLE "guard_driver_queue_events" (
  "id" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromStatus" "GuardDriverQueueTurnStatus",
  "toStatus" "GuardDriverQueueTurnStatus" NOT NULL,
  "reason" TEXT,
  "payload" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL,
  CONSTRAINT "guard_driver_queue_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "guard_driver_queue_turns_integrityHash_key" ON "guard_driver_queue_turns"("integrityHash");
CREATE INDEX "guard_driver_queue_turns_status_admittedAt_idx" ON "guard_driver_queue_turns"("status", "admittedAt");
CREATE INDEX "guard_driver_queue_turns_internalDriverId_status_idx" ON "guard_driver_queue_turns"("internalDriverId", "status");
CREATE INDEX "guard_driver_queue_turns_externalDriverId_status_idx" ON "guard_driver_queue_turns"("externalDriverId", "status");
CREATE INDEX "guard_driver_queue_turns_companyVehicleId_status_idx" ON "guard_driver_queue_turns"("companyVehicleId", "status");
CREATE INDEX "guard_driver_queue_turns_externalVehicleId_status_idx" ON "guard_driver_queue_turns"("externalVehicleId", "status");
CREATE INDEX "guard_driver_queue_turns_loadingId_idx" ON "guard_driver_queue_turns"("loadingId");
CREATE UNIQUE INDEX "guard_driver_queue_one_open_internal_driver" ON "guard_driver_queue_turns"("internalDriverId") WHERE "status" IN ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED');
CREATE UNIQUE INDEX "guard_driver_queue_one_open_external_driver" ON "guard_driver_queue_turns"("externalDriverId") WHERE "status" IN ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED');
CREATE UNIQUE INDEX "guard_driver_queue_one_open_company_vehicle" ON "guard_driver_queue_turns"("companyVehicleId") WHERE "status" IN ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED');
CREATE UNIQUE INDEX "guard_driver_queue_one_open_external_vehicle" ON "guard_driver_queue_turns"("externalVehicleId") WHERE "status" IN ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED');
CREATE UNIQUE INDEX "guard_driver_queue_events_eventHash_key" ON "guard_driver_queue_events"("eventHash");
CREATE INDEX "guard_driver_queue_events_turnId_recordedAt_idx" ON "guard_driver_queue_events"("turnId", "recordedAt");

ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_internalDriverId_fkey" FOREIGN KEY ("internalDriverId") REFERENCES "internal_driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "external_drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_companyVehicleId_fkey" FOREIGN KEY ("companyVehicleId") REFERENCES "company_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_externalVehicleId_fkey" FOREIGN KEY ("externalVehicleId") REFERENCES "external_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "driver_vehicle_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_turns_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guard_driver_queue_events" ADD CONSTRAINT "guard_driver_queue_events_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
