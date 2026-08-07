CREATE TABLE "biometric_governance_policies" (
  "id" TEXT PRIMARY KEY, "policyVersion" TEXT NOT NULL UNIQUE, "legalBasis" TEXT NOT NULL,
  "retentionDays" INTEGER NOT NULL CHECK ("retentionDays" > 0), "activeFrom" TIMESTAMP(3) NOT NULL,
  "retiredAt" TIMESTAMP(3), "recordedBy" TEXT NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "biometric_governance_policies_activeFrom_retiredAt_idx" ON "biometric_governance_policies"("activeFrom", "retiredAt");

CREATE TABLE "driver_biometric_enrollments" (
  "id" TEXT PRIMARY KEY, "personnelId" TEXT NOT NULL REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "governancePolicyId" TEXT NOT NULL REFERENCES "biometric_governance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','WITHDRAWN')),
  "acknowledgement" TEXT NOT NULL, "confirmationPhone" TEXT NOT NULL, "acknowledgedAt" TIMESTAMP(3) NOT NULL,
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "enrolledBy" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3) NOT NULL, "withdrawnAt" TIMESTAMP(3), "withdrawnBy" TEXT
);
CREATE INDEX "driver_biometric_enrollments_personnelId_status_idx" ON "driver_biometric_enrollments"("personnelId", "status");
CREATE UNIQUE INDEX "driver_biometric_enrollments_one_active" ON "driver_biometric_enrollments"("personnelId") WHERE "status" = 'ACTIVE';

CREATE TABLE "driver_biometric_templates" (
  "id" TEXT PRIMARY KEY, "enrollmentId" TEXT NOT NULL REFERENCES "driver_biometric_enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "finger" TEXT NOT NULL, "format" TEXT NOT NULL, "templateReference" TEXT NOT NULL UNIQUE,
  "protectedEnvelope" JSONB NOT NULL, "deviceEvidence" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("enrollmentId", "finger")
);

CREATE TABLE "dispatch_confirmation_sessions" (
  "id" TEXT PRIMARY KEY, "waybillId" TEXT NOT NULL REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "method" TEXT NOT NULL CHECK ("method" IN ('INTERNAL_BIOMETRIC','EXTERNAL_OTP_GUARD','INTERNAL_FALLBACK')),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','CONFIRMED','FAILED','EXPIRED','CANCELLED')),
  "driverSource" "GuardDriverSource" NOT NULL, "driverId" TEXT NOT NULL, "accountingActorId" TEXT NOT NULL,
  "waybillIntegrityHash" TEXT NOT NULL, "workstationId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "fallbackEligibleAt" TIMESTAMP(3), "fallbackFailure" JSONB, "confirmedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispatch_confirmation_sessions_waybillId_status_idx" ON "dispatch_confirmation_sessions"("waybillId", "status");
CREATE INDEX "dispatch_confirmation_sessions_expiresAt_status_idx" ON "dispatch_confirmation_sessions"("expiresAt", "status");
CREATE UNIQUE INDEX "dispatch_confirmation_sessions_one_active" ON "dispatch_confirmation_sessions"("waybillId") WHERE "status" = 'ACTIVE';

CREATE TABLE "dispatch_otp_challenges" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "digest" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "resendAfter" TIMESTAMP(3) NOT NULL,
  "incorrectCount" INTEGER NOT NULL DEFAULT 0 CHECK ("incorrectCount" BETWEEN 0 AND 5),
  "verifiedAt" TIMESTAMP(3), "invalidatedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispatch_otp_challenges_sessionId_createdAt_idx" ON "dispatch_otp_challenges"("sessionId", "createdAt");
CREATE UNIQUE INDEX "dispatch_otp_challenges_one_live" ON "dispatch_otp_challenges"("sessionId") WHERE "verifiedAt" IS NULL AND "invalidatedAt" IS NULL;

CREATE TABLE "dispatch_biometric_attempts" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sequence" INTEGER NOT NULL, "result" JSONB NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("sessionId", "sequence")
);
CREATE TABLE "dispatch_guard_approvals" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "guardActorId" TEXT NOT NULL, "reauthenticatedAt" TIMESTAMP(3) NOT NULL, "reason" TEXT,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispatch_guard_approvals_sessionId_approvedAt_idx" ON "dispatch_guard_approvals"("sessionId", "approvedAt");

CREATE TABLE "dispatch_exit_authorizations" (
  "id" TEXT PRIMARY KEY, "waybillId" TEXT NOT NULL REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL UNIQUE REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','REVOKED','CONSUMED','EXPIRED')),
  "method" TEXT NOT NULL, "driverSource" "GuardDriverSource" NOT NULL, "driverId" TEXT NOT NULL,
  "waybillIntegrityHash" TEXT NOT NULL, "evidenceSnapshot" JSONB NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "validUntil" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "revokedBy" TEXT, "revocationReason" TEXT,
  "consumedAt" TIMESTAMP(3), "consumedBy" TEXT
);
CREATE INDEX "dispatch_exit_authorizations_waybillId_status_idx" ON "dispatch_exit_authorizations"("waybillId", "status");
CREATE INDEX "dispatch_exit_authorizations_validUntil_status_idx" ON "dispatch_exit_authorizations"("validUntil", "status");
CREATE UNIQUE INDEX "dispatch_exit_authorizations_one_active" ON "dispatch_exit_authorizations"("waybillId") WHERE "status" = 'ACTIVE';

CREATE TABLE "dispatch_confirmation_alerts" (
  "id" TEXT PRIMARY KEY, "sessionId" TEXT NOT NULL REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "alertType" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispatch_confirmation_alerts_sessionId_createdAt_idx" ON "dispatch_confirmation_alerts"("sessionId", "createdAt");

CREATE OR REPLACE FUNCTION prevent_dispatch_confirmation_evidence_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'dispatch confirmation evidence is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER biometric_template_immutable BEFORE UPDATE OR DELETE ON "driver_biometric_templates" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_confirmation_evidence_mutation();
CREATE TRIGGER biometric_attempt_immutable BEFORE UPDATE OR DELETE ON "dispatch_biometric_attempts" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_confirmation_evidence_mutation();
CREATE TRIGGER guard_approval_immutable BEFORE UPDATE OR DELETE ON "dispatch_guard_approvals" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_confirmation_evidence_mutation();
CREATE TRIGGER confirmation_alert_immutable BEFORE UPDATE OR DELETE ON "dispatch_confirmation_alerts" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_confirmation_evidence_mutation();

CREATE OR REPLACE FUNCTION protect_exit_authorization_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."waybillId" <> OLD."waybillId" OR NEW."sessionId" <> OLD."sessionId" OR NEW."method" <> OLD."method"
    OR NEW."driverSource" <> OLD."driverSource" OR NEW."driverId" <> OLD."driverId"
    OR NEW."waybillIntegrityHash" <> OLD."waybillIntegrityHash" OR NEW."evidenceSnapshot" <> OLD."evidenceSnapshot"
    OR NEW."issuedAt" <> OLD."issuedAt" OR NEW."validUntil" <> OLD."validUntil" THEN
    RAISE EXCEPTION 'exit authorization identity and validity are immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER exit_authorization_identity_immutable BEFORE UPDATE ON "dispatch_exit_authorizations" FOR EACH ROW EXECUTE FUNCTION protect_exit_authorization_identity();
