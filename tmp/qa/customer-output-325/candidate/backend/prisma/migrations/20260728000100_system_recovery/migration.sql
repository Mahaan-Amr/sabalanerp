CREATE TABLE "recovery_operations" (
  "id" TEXT NOT NULL,
  "packageType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "storageName" TEXT,
  "originalName" TEXT,
  "encryptedSha256" TEXT,
  "size" BIGINT,
  "formatVersion" INTEGER NOT NULL DEFAULT 1,
  "sourceAppVersion" TEXT,
  "sourceCommit" TEXT,
  "sourcePostgresVersion" TEXT,
  "compatibility" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvalExpiresAt" TIMESTAMP(3),
  "breakGlassReason" TEXT,
  "readyAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "validatedAt" TIMESTAMP(3),
  "restoreStartedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recovery_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recovery_audit_events" (
  "id" TEXT NOT NULL,
  "operationId" TEXT,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "packageChecksum" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recovery_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_operations_status_createdAt_idx" ON "recovery_operations"("status", "createdAt");
CREATE INDEX "recovery_operations_packageType_downloadedAt_idx" ON "recovery_operations"("packageType", "downloadedAt");
CREATE INDEX "recovery_operations_expiresAt_idx" ON "recovery_operations"("expiresAt");
CREATE INDEX "recovery_audit_events_operationId_createdAt_idx" ON "recovery_audit_events"("operationId", "createdAt");
CREATE INDEX "recovery_audit_events_eventType_createdAt_idx" ON "recovery_audit_events"("eventType", "createdAt");

ALTER TABLE "recovery_operations"
  ADD CONSTRAINT "recovery_operations_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recovery_operations"
  ADD CONSTRAINT "recovery_operations_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recovery_audit_events"
  ADD CONSTRAINT "recovery_audit_events_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "recovery_operations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recovery_audit_events"
  ADD CONSTRAINT "recovery_audit_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
