-- AlterEnum
ALTER TYPE "SecurityDriverQueueTurnStatus" ADD VALUE 'ENTERED_LOADING_AREA';

-- DropIndex
DROP INDEX IF EXISTS "security_driver_queue_turns_loadingId_key";

-- AlterTable
ALTER TABLE "security_driver_queue_turns"
  ADD COLUMN "loadingAreaEnteredAt" TIMESTAMP(3),
  ADD COLUMN "loadingAreaEnteredBy" TEXT,
  ADD COLUMN "returnedToQueueAt" TIMESTAMP(3),
  ADD COLUMN "returnedToQueueBy" TEXT,
  ADD COLUMN "returnToQueueReason" TEXT;

-- CreateTable
CREATE TABLE "logistics_loading_driver_assignments" (
    "id" TEXT NOT NULL,
    "loadingId" TEXT NOT NULL,
    "queueTurnId" TEXT NOT NULL,
    "vehiclePairId" TEXT NOT NULL,
    "driverSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_loading_driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_loading_driver_allocations" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
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

    CONSTRAINT "logistics_loading_driver_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_loading_driver_assignments_queueTurnId_key" ON "logistics_loading_driver_assignments"("queueTurnId");

-- CreateIndex
CREATE INDEX "logistics_loading_driver_assignments_loadingId_idx" ON "logistics_loading_driver_assignments"("loadingId");

-- CreateIndex
CREATE INDEX "logistics_loading_driver_assignments_vehiclePairId_idx" ON "logistics_loading_driver_assignments"("vehiclePairId");

-- CreateIndex
CREATE INDEX "logistics_loading_driver_allocations_assignmentId_idx" ON "logistics_loading_driver_allocations"("assignmentId");

-- CreateIndex
CREATE INDEX "logistics_loading_driver_allocations_sourceContractItemId_idx" ON "logistics_loading_driver_allocations"("sourceContractItemId");

-- CreateIndex
CREATE INDEX "logistics_loading_driver_allocations_productId_idx" ON "logistics_loading_driver_allocations"("productId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "security_driver_queue_turns_loadingId_idx" ON "security_driver_queue_turns"("loadingId");

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_assignments" ADD CONSTRAINT "logistics_loading_driver_assignments_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_assignments" ADD CONSTRAINT "logistics_loading_driver_assignments_queueTurnId_fkey" FOREIGN KEY ("queueTurnId") REFERENCES "security_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_assignments" ADD CONSTRAINT "logistics_loading_driver_assignments_vehiclePairId_fkey" FOREIGN KEY ("vehiclePairId") REFERENCES "security_vehicle_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_allocations" ADD CONSTRAINT "logistics_loading_driver_allocations_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "logistics_loading_driver_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_allocations" ADD CONSTRAINT "logistics_loading_driver_allocations_sourceContractId_fkey" FOREIGN KEY ("sourceContractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_allocations" ADD CONSTRAINT "logistics_loading_driver_allocations_sourceContractItemId_fkey" FOREIGN KEY ("sourceContractItemId") REFERENCES "contract_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_loading_driver_allocations" ADD CONSTRAINT "logistics_loading_driver_allocations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
