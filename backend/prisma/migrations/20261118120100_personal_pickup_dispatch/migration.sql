ALTER TABLE "guard_driver_queue_turns" DROP CONSTRAINT "guard_driver_queue_source_shape";
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_source_shape" CHECK (
  ("driverSource" = 'INTERNAL' AND "internalDriverId" IS NOT NULL AND "companyVehicleId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL)
  OR ("driverSource" = 'EXTERNAL' AND "externalDriverId" IS NOT NULL AND "externalVehicleId" IS NOT NULL AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL)
  OR ("driverSource" = 'CUSTOMER_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL AND COALESCE(length("admissionSnapshot" #>> '{plate,normalizedPlate}'), 0) > 0)
  OR ("driverSource" = 'PERSONAL_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL AND "loadingId" IS NOT NULL AND COALESCE("admissionSnapshot" #>> '{kind}', '') = 'PERSONAL_PICKUP_SELECTION' AND "status" IN ('RESERVED_FOR_LOADING', 'LOADING_FINALIZED', 'EXIT_RECORDED', 'CLOSED_WITHOUT_LOADING', 'VOIDED'))
);
CREATE UNIQUE INDEX "guard_driver_queue_one_open_personal_loading"
  ON "guard_driver_queue_turns" ("loadingId") WHERE "driverSource" = 'PERSONAL_PICKUP'
  AND "status" IN ('RESERVED_FOR_LOADING', 'LOADING_FINALIZED');
ALTER TABLE "dispatch_confirmation_sessions" DROP CONSTRAINT "dispatch_confirmation_sessions_method_check";
ALTER TABLE "dispatch_confirmation_sessions" ADD CONSTRAINT "dispatch_confirmation_sessions_method_check"
  CHECK ("method" IN ('INTERNAL_BIOMETRIC', 'INTERNAL_FALLBACK', 'EXTERNAL_OTP_GUARD', 'EXTERNAL_BIOMETRIC', 'EXTERNAL_FALLBACK', 'CUSTOMER_PICKUP_OTP', 'PERSONAL_PICKUP_ACCOUNTING'));
