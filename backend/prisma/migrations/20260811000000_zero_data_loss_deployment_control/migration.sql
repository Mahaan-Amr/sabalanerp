CREATE TABLE "deployment_operations" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "releaseId" TEXT NOT NULL,
    "targetCommit" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "checkpointJson" JSONB,
    "reportJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployment_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deployment_operations_activeKey_key" ON "deployment_operations"("activeKey");
CREATE UNIQUE INDEX "deployment_operations_leaseToken_key" ON "deployment_operations"("leaseToken");
CREATE INDEX "deployment_operations_phase_leaseExpiresAt_idx" ON "deployment_operations"("phase", "leaseExpiresAt");
CREATE INDEX "deployment_operations_startedAt_idx" ON "deployment_operations"("startedAt");
