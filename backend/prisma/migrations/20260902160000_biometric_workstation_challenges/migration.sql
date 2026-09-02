CREATE TABLE "biometric_connector_challenges" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "workstationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "contextHash" TEXT,
    "finger" TEXT,
    "commandDigest" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "resultDigest" TEXT,
    "resultSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "biometric_connector_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "biometric_connector_challenges_nonceHash_key" ON "biometric_connector_challenges"("nonceHash");
CREATE INDEX "biometric_connector_challenges_subjectId_operation_status_idx" ON "biometric_connector_challenges"("subjectId", "operation", "status");
CREATE INDEX "biometric_connector_challenges_expiresAt_status_idx" ON "biometric_connector_challenges"("expiresAt", "status");
