CREATE TABLE "notification_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" TEXT,
  "workspace" TEXT,
  "feature" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "payload" JSONB,
  "deduplicationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_policy_versions" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "mandatory" BOOLEAN NOT NULL DEFAULT false,
  "titleTemplate" TEXT NOT NULL,
  "messageTemplate" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  "channels" JSONB NOT NULL,
  "recipientResolvers" JSONB NOT NULL,
  "batching" TEXT NOT NULL DEFAULT 'IMMEDIATE',
  "createdById" TEXT,
  "changeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_policy_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "security_notifications"
  ADD COLUMN "eventId" TEXT,
  ADD COLUMN "policyVersionId" TEXT,
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "actionUrl" TEXT;

CREATE TABLE "notification_outbox" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_delivery_attempts" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_events_deduplicationKey_key" ON "notification_events"("deduplicationKey");
CREATE INDEX "notification_events_type_createdAt_idx" ON "notification_events"("type", "createdAt");
CREATE INDEX "notification_events_resourceType_resourceId_createdAt_idx" ON "notification_events"("resourceType", "resourceId", "createdAt");
CREATE UNIQUE INDEX "notification_policy_versions_eventType_version_key" ON "notification_policy_versions"("eventType", "version");
CREATE INDEX "notification_policy_versions_eventType_createdAt_idx" ON "notification_policy_versions"("eventType", "createdAt");
CREATE UNIQUE INDEX "security_notifications_eventId_userId_key" ON "security_notifications"("eventId", "userId");
CREATE INDEX "security_notifications_type_createdAt_idx" ON "security_notifications"("type", "createdAt");
CREATE UNIQUE INDEX "notification_outbox_eventId_key" ON "notification_outbox"("eventId");
CREATE INDEX "notification_outbox_status_availableAt_idx" ON "notification_outbox"("status", "availableAt");
CREATE INDEX "notification_delivery_attempts_notificationId_channel_createdAt_idx" ON "notification_delivery_attempts"("notificationId", "channel", "createdAt");
CREATE INDEX "notification_delivery_attempts_status_createdAt_idx" ON "notification_delivery_attempts"("status", "createdAt");

ALTER TABLE "notification_events"
  ADD CONSTRAINT "notification_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_policy_versions"
  ADD CONSTRAINT "notification_policy_versions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "security_notifications"
  ADD CONSTRAINT "security_notifications_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "security_notifications"
  ADD CONSTRAINT "security_notifications_policyVersionId_fkey"
  FOREIGN KEY ("policyVersionId") REFERENCES "notification_policy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_delivery_attempts"
  ADD CONSTRAINT "notification_delivery_attempts_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "security_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
