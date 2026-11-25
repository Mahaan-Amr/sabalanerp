BEGIN;

CREATE TYPE "GuardProjectReturnStatus" AS ENUM ('AWAITING_RECEIPT', 'CANCELLED_WITHOUT_DELIVERY', 'RECEIVED');

ALTER TABLE "guard_driver_queue_turns" ADD COLUMN "projectReturnStatus" "GuardProjectReturnStatus";

ALTER TABLE "guard_driver_queue_turns" DROP CONSTRAINT "guard_driver_queue_source_shape";
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_driver_queue_source_shape" CHECK (
  ("driverSource" = 'INTERNAL' AND "internalDriverId" IS NOT NULL AND "companyVehicleId" IS NOT NULL AND "assignmentId" IS NOT NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL)
  OR ("driverSource" = 'EXTERNAL' AND "externalDriverId" IS NOT NULL AND "externalVehicleId" IS NOT NULL AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL)
  OR ("driverSource" = 'CUSTOMER_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL AND COALESCE(length("admissionSnapshot" #>> '{plate,normalizedPlate}'), 0) > 0)
  OR ("driverSource" = 'PERSONAL_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL AND "projectReturnStatus" IS NULL AND "loadingId" IS NOT NULL AND COALESCE("admissionSnapshot" #>> '{kind}', '') = 'PERSONAL_PICKUP_SELECTION' AND "status" IN ('RESERVED_FOR_LOADING', 'LOADING_FINALIZED', 'EXIT_RECORDED', 'CLOSED_WITHOUT_LOADING', 'VOIDED'))
  OR ("driverSource" = 'PERSONAL_PICKUP' AND "internalDriverId" IS NULL AND "companyVehicleId" IS NULL AND "assignmentId" IS NULL AND "externalDriverId" IS NULL AND "externalVehicleId" IS NULL AND "loadingId" IS NULL AND "projectReturnStatus" IS NOT NULL AND "status" IN ('WAITING_AT_GATE', 'EXIT_RECORDED'))
);

ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_project_return_visit_shape" CHECK (
  "projectReturnStatus" IS NULL OR (
    COALESCE("admissionSnapshot" ->> 'purpose', '') = 'PROJECT_RETURN'
    AND COALESCE(length("admissionSnapshot" #>> '{plate,plate}'), 0) > 0
    AND CASE "projectReturnStatus"
      WHEN 'AWAITING_RECEIPT' THEN "status" = 'WAITING_AT_GATE' AND "loadingId" IS NULL
      WHEN 'CANCELLED_WITHOUT_DELIVERY' THEN "status" IN ('WAITING_AT_GATE', 'EXIT_RECORDED') AND "loadingId" IS NULL
      WHEN 'RECEIVED' THEN TRUE
    END
  )
);

CREATE INDEX "guard_driver_queue_turns_projectReturnStatus_status_admittedAt_idx"
  ON "guard_driver_queue_turns" ("projectReturnStatus", "status", "admittedAt");

COMMIT;
