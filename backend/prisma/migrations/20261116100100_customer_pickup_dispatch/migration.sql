ALTER TABLE "guard_driver_queue_turns" DROP CONSTRAINT "guard_driver_queue_source_shape";
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_source_shape" CHECK (
    ("driverSource" = 'INTERNAL' AND "internalDriverId" IS NOT NULL AND "companyVehicleId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL)
    OR
    ("driverSource" = 'EXTERNAL' AND "externalDriverId" IS NOT NULL AND "externalVehicleId" IS NOT NULL AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL)
    OR
    ("driverSource" = 'CUSTOMER_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL
      AND COALESCE(length("admissionSnapshot" #>> '{plate,normalizedPlate}'), 0) > 0)
);

CREATE UNIQUE INDEX "guard_driver_queue_one_open_customer_pickup_plate"
ON "guard_driver_queue_turns" (("admissionSnapshot" #>> '{plate,normalizedPlate}'))
WHERE "driverSource" = 'CUSTOMER_PICKUP'
  AND "status" IN ('WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED');

CREATE TABLE "dispatch_pickup_verifications" (
  "candidateId" TEXT NOT NULL PRIMARY KEY REFERENCES "accounting_dispatch_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "challengeId" TEXT NOT NULL UNIQUE,
  "digest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "resendAfter" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sendCount" INTEGER NOT NULL DEFAULT 1,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT
);

ALTER TABLE "dispatch_confirmation_sessions" DROP CONSTRAINT "dispatch_confirmation_sessions_method_check";
ALTER TABLE "dispatch_confirmation_sessions" ADD CONSTRAINT "dispatch_confirmation_sessions_method_check"
  CHECK ("method" IN ('INTERNAL_BIOMETRIC', 'INTERNAL_FALLBACK', 'EXTERNAL_OTP_GUARD', 'EXTERNAL_BIOMETRIC', 'EXTERNAL_FALLBACK', 'CUSTOMER_PICKUP_OTP'));
