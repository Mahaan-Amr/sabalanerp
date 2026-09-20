-- The product no longer records biometric consent, governance-policy,
-- retention-schedule, or counsel-approval evidence.
ALTER TABLE "driver_biometric_enrollments"
  DROP CONSTRAINT "driver_biometric_enrollments_governancePolicyId_fkey";

ALTER TABLE "driver_biometric_enrollments"
  DROP COLUMN "governancePolicyId",
  DROP COLUMN "acknowledgement",
  DROP COLUMN "acknowledgedAt",
  DROP COLUMN "retentionUntil";

DROP TABLE "biometric_governance_policies";

ALTER TABLE "driver_biometric_enrollments"
  DROP CONSTRAINT "driver_biometric_enrollments_status_check";

UPDATE "driver_biometric_enrollments"
SET "status" = 'INACTIVE'
WHERE "status" = 'WITHDRAWN';

ALTER TABLE "driver_biometric_enrollments"
  RENAME COLUMN "withdrawnAt" TO "deactivatedAt";

ALTER TABLE "driver_biometric_enrollments"
  RENAME COLUMN "withdrawnBy" TO "deactivatedBy";

ALTER TABLE "driver_biometric_enrollments"
  ADD CONSTRAINT "driver_biometric_enrollments_status_check"
  CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
