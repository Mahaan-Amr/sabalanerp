CREATE TABLE "hr_authorization_audit_events" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_authorization_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_authorization_audit_events_entityType_entityId_createdAt_idx"
  ON "hr_authorization_audit_events"("entityType", "entityId", "createdAt");

CREATE INDEX "hr_authorization_audit_events_actorUserId_createdAt_idx"
  ON "hr_authorization_audit_events"("actorUserId", "createdAt");
