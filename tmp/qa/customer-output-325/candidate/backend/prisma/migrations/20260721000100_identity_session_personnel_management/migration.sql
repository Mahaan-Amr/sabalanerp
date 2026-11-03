CREATE TYPE "UserCreationSource" AS ENUM ('LEGACY', 'MANAGED', 'IMPORTED', 'SYSTEM_SEEDED');
CREATE TYPE "CreatorAttributionKind" AS ENUM ('UNKNOWN', 'AUTOMATIC', 'MANUAL');

ALTER TABLE "users"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "creationSource" "UserCreationSource" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "creatorAttributionKind" "CreatorAttributionKind" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "creatorDisplayNameSnapshot" TEXT,
  ADD COLUMN "creatorUsernameSnapshot" TEXT,
  ADD COLUMN "creatorAttributedById" TEXT,
  ADD COLUMN "creatorAttributionReason" TEXT,
  ADD COLUMN "creatorAttributedAt" TIMESTAMP(3),
  ADD COLUMN "erasedAt" TIMESTAMP(3),
  ADD COLUMN "erasureReason" TEXT,
  ADD COLUMN "erasedById" TEXT,
  ADD COLUMN "erasedDisplayName" TEXT,
  ADD COLUMN "erasedUsernameSnapshot" TEXT;

CREATE TABLE "recognized_browser_profiles" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT,
  "browser" TEXT,
  "operatingSystem" TEXT,
  "deviceCategory" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstIp" TEXT,
  "lastIp" TEXT,
  CONSTRAINT "recognized_browser_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "browserProfileId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "browser" TEXT,
  "operatingSystem" TEXT,
  "deviceCategory" TEXT,
  "approximateLocation" TEXT,
  "isNewBrowser" BOOLEAN NOT NULL DEFAULT false,
  "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idleExpiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "authentication_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "userId" TEXT,
  "actorId" TEXT,
  "attemptedIdentifier" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "browser" TEXT,
  "operatingSystem" TEXT,
  "deviceCategory" TEXT,
  "safeCategory" TEXT,
  "sessionIdSnapshot" TEXT,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authentication_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "security_notifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "referenceId" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_bulk_operations" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "previewToken" TEXT NOT NULL,
  "selectionHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedData" JSONB,
  "previewData" JSONB NOT NULL,
  "resultData" JSONB,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_bulk_operations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_bulk_operations" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "previewToken" TEXT NOT NULL,
  "selectionHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestedData" JSONB,
  "previewData" JSONB NOT NULL,
  "resultData" JSONB,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_bulk_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recognized_browser_profiles_publicId_key" ON "recognized_browser_profiles"("publicId");
CREATE INDEX "recognized_browser_profiles_userId_lastSeenAt_idx" ON "recognized_browser_profiles"("userId", "lastSeenAt");
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");
CREATE INDEX "auth_sessions_userId_revokedAt_absoluteExpiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "absoluteExpiresAt");
CREATE INDEX "auth_sessions_lastActivityAt_idx" ON "auth_sessions"("lastActivityAt");
CREATE INDEX "authentication_events_type_createdAt_idx" ON "authentication_events"("type", "createdAt");
CREATE INDEX "authentication_events_userId_createdAt_idx" ON "authentication_events"("userId", "createdAt");
CREATE INDEX "authentication_events_attemptedIdentifier_createdAt_idx" ON "authentication_events"("attemptedIdentifier", "createdAt");
CREATE INDEX "authentication_events_ipAddress_createdAt_idx" ON "authentication_events"("ipAddress", "createdAt");
CREATE INDEX "security_notifications_userId_readAt_createdAt_idx" ON "security_notifications"("userId", "readAt", "createdAt");
CREATE UNIQUE INDEX "personnel_bulk_operations_previewToken_key" ON "personnel_bulk_operations"("previewToken");
CREATE INDEX "personnel_bulk_operations_actorId_createdAt_idx" ON "personnel_bulk_operations"("actorId", "createdAt");
CREATE UNIQUE INDEX "user_bulk_operations_previewToken_key" ON "user_bulk_operations"("previewToken");
CREATE INDEX "user_bulk_operations_actorId_createdAt_idx" ON "user_bulk_operations"("actorId", "createdAt");
CREATE INDEX "users_createdByUserId_idx" ON "users"("createdByUserId");
CREATE INDEX "users_erasedAt_idx" ON "users"("erasedAt");

ALTER TABLE "users" ADD CONSTRAINT "users_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_creatorAttributedById_fkey" FOREIGN KEY ("creatorAttributedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_erasedById_fkey" FOREIGN KEY ("erasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recognized_browser_profiles" ADD CONSTRAINT "recognized_browser_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_browserProfileId_fkey" FOREIGN KEY ("browserProfileId") REFERENCES "recognized_browser_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "authentication_events" ADD CONSTRAINT "authentication_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "security_notifications" ADD CONSTRAINT "security_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_bulk_operations" ADD CONSTRAINT "personnel_bulk_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_bulk_operations" ADD CONSTRAINT "user_bulk_operations_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
