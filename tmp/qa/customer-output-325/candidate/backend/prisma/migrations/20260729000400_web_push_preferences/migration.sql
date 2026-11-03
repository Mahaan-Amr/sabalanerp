CREATE TABLE "web_push_subscriptions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "userAgent" TEXT,
  "disabledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "webPushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "mutedCategories" JSONB NOT NULL,
  "lowPriorityDelivery" TEXT NOT NULL DEFAULT 'IMMEDIATE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_preference_audits" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preference_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_key" ON "web_push_subscriptions"("endpoint");
CREATE INDEX "web_push_subscriptions_userId_disabledAt_createdAt_idx" ON "web_push_subscriptions"("userId", "disabledAt", "createdAt");
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");
CREATE INDEX "notification_preference_audits_userId_createdAt_idx" ON "notification_preference_audits"("userId", "createdAt");

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preference_audits"
  ADD CONSTRAINT "notification_preference_audits_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
