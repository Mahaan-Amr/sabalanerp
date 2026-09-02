ALTER TABLE "biometric_connector_challenges"
ADD COLUMN "processingStartedAt" TIMESTAMP(3);

CREATE INDEX "biometric_connector_challenges_status_processingStartedAt_idx"
ON "biometric_connector_challenges"("status", "processingStartedAt");
