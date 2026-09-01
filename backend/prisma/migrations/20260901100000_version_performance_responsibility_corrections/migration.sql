ALTER TABLE "hr_assignment_performance_responsibilities"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "supersedesResponsibilityId" TEXT;

DROP INDEX "hr_perf_resp_assignment_from_key";
CREATE UNIQUE INDEX "hr_perf_resp_active_assignment_from_key"
  ON "hr_assignment_performance_responsibilities"("employmentAssignmentId", "effectiveFrom")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "hr_perf_resp_assignment_status_period_idx"
  ON "hr_assignment_performance_responsibilities"("employmentAssignmentId", "status", "effectiveFrom", "effectiveTo");

ALTER TABLE "hr_assignment_performance_responsibilities"
  ADD CONSTRAINT "hr_perf_resp_status_check" CHECK ("status" IN ('ACTIVE', 'SUPERSEDED')),
  ADD CONSTRAINT "hr_perf_resp_supersedes_fkey" FOREIGN KEY ("supersedesResponsibilityId")
    REFERENCES "hr_assignment_performance_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION hr_guard_performance_responsibility_period()
RETURNS trigger AS $$
BEGIN
  IF NEW."employmentAssignmentId" = NEW."supervisorAssignmentId" THEN
    RAISE EXCEPTION 'performance responsibility cannot be self-referential';
  END IF;
  IF NEW."status" = 'ACTIVE' AND EXISTS (
    SELECT 1
    FROM "hr_assignment_performance_responsibilities" existing
    WHERE existing."employmentAssignmentId" = NEW."employmentAssignmentId"
      AND existing."status" = 'ACTIVE'
      AND existing."id" <> NEW."id"
      AND existing."effectiveFrom" < COALESCE(NEW."effectiveTo", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < COALESCE(existing."effectiveTo", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION 'overlapping performance responsibility periods are not allowed';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'superseded performance responsibility history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
