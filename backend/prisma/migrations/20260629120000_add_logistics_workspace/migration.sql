-- CreateEnum
CREATE TYPE "LogisticsLoadingStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

-- CreateTable
CREATE TABLE "logistics_drivers" (
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

    CONSTRAINT "logistics_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_loadings" (
    "id" TEXT NOT NULL,
    "loadingNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "LogisticsLoadingStatus" NOT NULL DEFAULT 'DRAFT',
    "loadingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "driverId" TEXT,
    "driverSnapshot" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancellationReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_loadings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_loading_lines" (
    "id" TEXT NOT NULL,
    "loadingId" TEXT NOT NULL,
    "sourceContractId" TEXT NOT NULL,
    "sourceContractItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "khatRas" DECIMAL(12,3),
    "pieceCount" DECIMAL(12,3),
    "plus" DECIMAL(12,3),
    "minus" DECIMAL(12,3),
    "productSnapshot" JSONB,
    "sourceSnapshot" JSONB,
    "calculationSnapshot" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_loading_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_loading_corrections" (
    "id" TEXT NOT NULL,
    "loadingId" TEXT NOT NULL,
    "loadingLineId" TEXT,
    "sourceContractItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deltaQuantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_loading_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_loadings_loadingNumber_key" ON "logistics_loadings"("loadingNumber");

-- CreateIndex
CREATE INDEX "logistics_drivers_createdBy_idx" ON "logistics_drivers"("createdBy");
CREATE INDEX "logistics_drivers_isActive_idx" ON "logistics_drivers"("isActive");
CREATE INDEX "logistics_loadings_customerId_idx" ON "logistics_loadings"("customerId");
CREATE INDEX "logistics_loadings_projectId_idx" ON "logistics_loadings"("projectId");
CREATE INDEX "logistics_loadings_status_idx" ON "logistics_loadings"("status");
CREATE INDEX "logistics_loadings_driverId_idx" ON "logistics_loadings"("driverId");
CREATE INDEX "logistics_loadings_loadingDate_idx" ON "logistics_loadings"("loadingDate");
CREATE INDEX "logistics_loading_lines_loadingId_idx" ON "logistics_loading_lines"("loadingId");
CREATE INDEX "logistics_loading_lines_sourceContractId_idx" ON "logistics_loading_lines"("sourceContractId");
CREATE INDEX "logistics_loading_lines_sourceContractItemId_idx" ON "logistics_loading_lines"("sourceContractItemId");
CREATE INDEX "logistics_loading_lines_productId_idx" ON "logistics_loading_lines"("productId");
CREATE INDEX "logistics_loading_corrections_loadingId_idx" ON "logistics_loading_corrections"("loadingId");
CREATE INDEX "logistics_loading_corrections_loadingLineId_idx" ON "logistics_loading_corrections"("loadingLineId");
CREATE INDEX "logistics_loading_corrections_sourceContractItemId_idx" ON "logistics_loading_corrections"("sourceContractItemId");
CREATE INDEX "logistics_loading_corrections_productId_idx" ON "logistics_loading_corrections"("productId");

-- AddForeignKey
ALTER TABLE "logistics_drivers" ADD CONSTRAINT "logistics_drivers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loadings" ADD CONSTRAINT "logistics_loadings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loadings" ADD CONSTRAINT "logistics_loadings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loadings" ADD CONSTRAINT "logistics_loadings_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "logistics_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_lines" ADD CONSTRAINT "logistics_loading_lines_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_lines" ADD CONSTRAINT "logistics_loading_lines_sourceContractId_fkey" FOREIGN KEY ("sourceContractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_lines" ADD CONSTRAINT "logistics_loading_lines_sourceContractItemId_fkey" FOREIGN KEY ("sourceContractItemId") REFERENCES "contract_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_lines" ADD CONSTRAINT "logistics_loading_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_corrections" ADD CONSTRAINT "logistics_loading_corrections_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_corrections" ADD CONSTRAINT "logistics_loading_corrections_loadingLineId_fkey" FOREIGN KEY ("loadingLineId") REFERENCES "logistics_loading_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_corrections" ADD CONSTRAINT "logistics_loading_corrections_sourceContractItemId_fkey" FOREIGN KEY ("sourceContractItemId") REFERENCES "contract_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_loading_corrections" ADD CONSTRAINT "logistics_loading_corrections_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
