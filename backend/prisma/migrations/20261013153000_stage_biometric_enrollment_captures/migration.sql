ALTER TABLE "biometric_connector_challenges"
  ADD COLUMN "enrollmentSessionId" TEXT,
  ADD COLUMN "acceptedAt" TIMESTAMP(3),
  ADD COLUMN "stagedExpiresAt" TIMESTAMP(3),
  ADD COLUMN "protectedCapture" JSONB,
  ADD COLUMN "enrollmentId" TEXT;
CREATE INDEX "biometric_connector_challenges_enrollmentSessionId_actorId_su_idx"
  ON "biometric_connector_challenges"("enrollmentSessionId", "actorId", "subjectId");
CREATE INDEX "biometric_connector_challenges_status_stagedExpiresAt_idx"
  ON "biometric_connector_challenges"("status", "stagedExpiresAt");
