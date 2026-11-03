ALTER TABLE "biometric_governance_policies"
  ADD COLUMN "consentWordingVersion" TEXT NOT NULL DEFAULT 'legacy-verification',
  ADD COLUMN "templateRetentionDays" INTEGER,
  ADD COLUMN "confirmationEvidenceRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "securityLogRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "exportRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "backupRetentionDays" INTEGER NOT NULL DEFAULT 365,
  ADD COLUMN "deletionCertificateRetentionDays" INTEGER NOT NULL DEFAULT 2555,
  ADD COLUMN "accessControlPolicy" TEXT NOT NULL DEFAULT 'legacy-verification',
  ADD COLUMN "legalHoldPolicy" TEXT NOT NULL DEFAULT 'legacy-verification',
  ADD COLUMN "incidentResponsePolicy" TEXT NOT NULL DEFAULT 'legacy-verification',
  ADD COLUMN "disclosurePolicy" TEXT NOT NULL DEFAULT 'legacy-verification',
  ADD COLUMN "counselApprovedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "counselApprovedBy" TEXT NOT NULL DEFAULT 'legacy-verification';
UPDATE "biometric_governance_policies" SET "templateRetentionDays" = "retentionDays";
ALTER TABLE "biometric_governance_policies" ALTER COLUMN "templateRetentionDays" SET NOT NULL;
ALTER TABLE "biometric_governance_policies" DROP COLUMN "retentionDays";

ALTER TABLE "dispatch_exit_authorizations" ADD COLUMN "integrityHash" TEXT;
UPDATE "dispatch_exit_authorizations" SET "integrityHash" = md5("id" || ':' || "waybillIntegrityHash" || ':' || "issuedAt"::text);
ALTER TABLE "dispatch_exit_authorizations" ALTER COLUMN "integrityHash" SET NOT NULL;
CREATE UNIQUE INDEX "dispatch_exit_authorizations_integrityHash_key" ON "dispatch_exit_authorizations"("integrityHash");

CREATE OR REPLACE FUNCTION protect_exit_authorization_identity() RETURNS trigger AS $$
BEGIN
  IF NEW."waybillId" <> OLD."waybillId" OR NEW."sessionId" <> OLD."sessionId" OR NEW."method" <> OLD."method"
    OR NEW."driverSource" <> OLD."driverSource" OR NEW."driverId" <> OLD."driverId"
    OR NEW."waybillIntegrityHash" <> OLD."waybillIntegrityHash" OR NEW."evidenceSnapshot" <> OLD."evidenceSnapshot"
    OR NEW."integrityHash" <> OLD."integrityHash" OR NEW."issuedAt" <> OLD."issuedAt" OR NEW."validUntil" <> OLD."validUntil" THEN
    RAISE EXCEPTION 'exit authorization identity and validity are immutable';
  END IF;
  IF OLD."status" <> NEW."status" AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('REVOKED','CONSUMED','EXPIRED')) THEN
    RAISE EXCEPTION 'invalid exit authorization status transition';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_confirmation_session_lifecycle() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> NEW."status" AND NOT (OLD."status" = 'ACTIVE' AND NEW."status" IN ('CONFIRMED','FAILED','EXPIRED','CANCELLED')) THEN
    RAISE EXCEPTION 'invalid confirmation session status transition';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER confirmation_session_lifecycle BEFORE UPDATE ON "dispatch_confirmation_sessions" FOR EACH ROW EXECUTE FUNCTION protect_confirmation_session_lifecycle();
