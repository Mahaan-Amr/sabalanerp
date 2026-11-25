BEGIN;

ALTER TABLE "guard_driver_queue_turns" ADD COLUMN "projectReturnReleasedAt" TIMESTAMP(3);

ALTER TABLE "guard_driver_queue_turns" DROP CONSTRAINT "guard_project_return_visit_shape";
ALTER TABLE "guard_driver_queue_turns" ADD CONSTRAINT "guard_project_return_visit_shape" CHECK (
  CASE
    WHEN "projectReturnStatus" IS NULL THEN "projectReturnReleasedAt" IS NULL
    ELSE
      COALESCE("admissionSnapshot" ->> 'purpose', '') = 'PROJECT_RETURN'
      AND COALESCE(length("admissionSnapshot" #>> '{plate,plate}'), 0) > 0
      AND CASE
        WHEN "projectReturnStatus" = 'AWAITING_RECEIPT' THEN
          "status" = 'WAITING_AT_GATE' AND "loadingId" IS NULL AND "projectReturnReleasedAt" IS NULL
        WHEN "projectReturnReleasedAt" IS NULL THEN
          "status" IN ('WAITING_AT_GATE', 'EXIT_RECORDED') AND "loadingId" IS NULL
        ELSE TRUE
      END
  END
);

COMMIT;
