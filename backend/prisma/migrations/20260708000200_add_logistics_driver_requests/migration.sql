-- CreateEnum
CREATE TYPE "LogisticsDriverRequestStatus" AS ENUM ('PENDING_SECURITY', 'DRIVER_ENTERED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "security_driver_queue_turns" ADD COLUMN "driverRequestId" TEXT;

-- CreateTable
CREATE TABLE "logistics_driver_requests" (
    "id" TEXT NOT NULL,
    "loadingId" TEXT NOT NULL,
    "status" "LogisticsDriverRequestStatus" NOT NULL DEFAULT 'PENDING_SECURITY',
    "contextSnapshot" JSONB,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledBy" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_driver_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_driver_queue_turns_driverRequestId_key" ON "security_driver_queue_turns"("driverRequestId");

-- CreateIndex
CREATE INDEX "security_driver_queue_turns_driverRequestId_idx" ON "security_driver_queue_turns"("driverRequestId");

-- CreateIndex
CREATE INDEX "logistics_driver_requests_loadingId_status_idx" ON "logistics_driver_requests"("loadingId", "status");

-- CreateIndex
CREATE INDEX "logistics_driver_requests_status_requestedAt_idx" ON "logistics_driver_requests"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "logistics_driver_requests_requestedBy_idx" ON "logistics_driver_requests"("requestedBy");

-- AddForeignKey
ALTER TABLE "security_driver_queue_turns" ADD CONSTRAINT "security_driver_queue_turns_driverRequestId_fkey" FOREIGN KEY ("driverRequestId") REFERENCES "logistics_driver_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_driver_requests" ADD CONSTRAINT "logistics_driver_requests_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_driver_requests" ADD CONSTRAINT "logistics_driver_requests_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_driver_requests" ADD CONSTRAINT "logistics_driver_requests_fulfilledBy_fkey" FOREIGN KEY ("fulfilledBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_driver_requests" ADD CONSTRAINT "logistics_driver_requests_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
