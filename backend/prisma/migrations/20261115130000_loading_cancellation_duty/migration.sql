-- A loading cancellation review has no assigned decision deadline.
ALTER TABLE "hr_duties" DROP CONSTRAINT "duty_deadline_required_for_other_sources";
ALTER TABLE "hr_duties" ADD CONSTRAINT "duty_deadline_required_for_other_sources"
  CHECK ("dueAt" IS NOT NULL OR "sourceType" IN (
    'CONTRACT_DISPATCH', 'PURCHASING_INQUIRY', 'LOGISTICS_LOADING_CANCELLATION'
  ));

CREATE UNIQUE INDEX "hr_duties_one_open_loading_cancellation"
  ON "hr_duties" ("sourceId")
  WHERE "sourceType" = 'LOGISTICS_LOADING_CANCELLATION' AND "status" = 'OPEN';
