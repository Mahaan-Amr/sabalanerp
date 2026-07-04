CREATE TYPE "SecurityVehicleMovementDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TYPE "SecurityVehicleMovementPurpose" AS ENUM ('OUTSIDE_PURCHASE', 'SALES_RETURN', 'CONSIGNMENT', 'SALES_EXIT', 'CUSTOMER_PERSONAL_CAR_EXIT', 'MISC');

CREATE TYPE "SecurityVehicleMovementStatus" AS ENUM ('ENTRY_RECORDED', 'INFO_COMPLETED', 'ENTRY_VOIDED', 'READY_TO_EXIT', 'EXITED', 'EXIT_VOIDED');

CREATE TYPE "SecurityVehicleAttachmentCategory" AS ENUM ('VEHICLE_PLATE', 'DRIVER_DOCUMENT', 'WAYBILL', 'PURCHASE_INVOICE', 'CARGO', 'OTHER');

CREATE TABLE "security_vehicle_pairs" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationalCode" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_vehicle_pairs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_vehicle_movements" (
    "id" TEXT NOT NULL,
    "movementNumber" TEXT NOT NULL,
    "direction" "SecurityVehicleMovementDirection" NOT NULL,
    "purpose" "SecurityVehicleMovementPurpose" NOT NULL,
    "status" "SecurityVehicleMovementStatus" NOT NULL DEFAULT 'ENTRY_RECORDED',
    "vehiclePairId" TEXT,
    "loadingId" TEXT,
    "customerId" TEXT,
    "projectId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,
    "driverSnapshot" JSONB,
    "documentSnapshot" JSONB,
    "settlementSnapshot" JSONB,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_vehicle_movements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_vehicle_attachments" (
    "id" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "category" "SecurityVehicleAttachmentCategory" NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_vehicle_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_supervisor_reports" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "shiftId" TEXT,
    "authorId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "incidents" TEXT,
    "followUpNotes" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_supervisor_reports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "logistics_loadings" ADD COLUMN "vehiclePairId" TEXT;

CREATE UNIQUE INDEX "security_vehicle_movements_movementNumber_key" ON "security_vehicle_movements"("movementNumber");
CREATE INDEX "security_vehicle_pairs_createdBy_idx" ON "security_vehicle_pairs"("createdBy");
CREATE INDEX "security_vehicle_pairs_isActive_idx" ON "security_vehicle_pairs"("isActive");
CREATE INDEX "security_vehicle_movements_direction_idx" ON "security_vehicle_movements"("direction");
CREATE INDEX "security_vehicle_movements_purpose_idx" ON "security_vehicle_movements"("purpose");
CREATE INDEX "security_vehicle_movements_status_idx" ON "security_vehicle_movements"("status");
CREATE INDEX "security_vehicle_movements_vehiclePairId_idx" ON "security_vehicle_movements"("vehiclePairId");
CREATE INDEX "security_vehicle_movements_loadingId_idx" ON "security_vehicle_movements"("loadingId");
CREATE INDEX "security_vehicle_movements_customerId_idx" ON "security_vehicle_movements"("customerId");
CREATE INDEX "security_vehicle_movements_projectId_idx" ON "security_vehicle_movements"("projectId");
CREATE INDEX "security_vehicle_movements_occurredAt_idx" ON "security_vehicle_movements"("occurredAt");
CREATE INDEX "security_vehicle_attachments_movementId_idx" ON "security_vehicle_attachments"("movementId");
CREATE INDEX "security_vehicle_attachments_category_idx" ON "security_vehicle_attachments"("category");
CREATE INDEX "security_supervisor_reports_reportDate_idx" ON "security_supervisor_reports"("reportDate");
CREATE INDEX "security_supervisor_reports_shiftId_idx" ON "security_supervisor_reports"("shiftId");
CREATE INDEX "security_supervisor_reports_authorId_idx" ON "security_supervisor_reports"("authorId");
CREATE INDEX "logistics_loadings_vehiclePairId_idx" ON "logistics_loadings"("vehiclePairId");

ALTER TABLE "security_vehicle_pairs" ADD CONSTRAINT "security_vehicle_pairs_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_vehicle_movements" ADD CONSTRAINT "security_vehicle_movements_vehiclePairId_fkey" FOREIGN KEY ("vehiclePairId") REFERENCES "security_vehicle_pairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_vehicle_movements" ADD CONSTRAINT "security_vehicle_movements_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_vehicle_movements" ADD CONSTRAINT "security_vehicle_movements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_vehicle_movements" ADD CONSTRAINT "security_vehicle_movements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_vehicle_attachments" ADD CONSTRAINT "security_vehicle_attachments_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "security_vehicle_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_supervisor_reports" ADD CONSTRAINT "security_supervisor_reports_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "logistics_loadings" ADD CONSTRAINT "logistics_loadings_vehiclePairId_fkey" FOREIGN KEY ("vehiclePairId") REFERENCES "security_vehicle_pairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
