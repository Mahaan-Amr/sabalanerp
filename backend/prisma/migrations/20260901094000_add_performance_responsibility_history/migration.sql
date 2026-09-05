CREATE TABLE "hr_assignment_performance_responsibilities" (
  "id" TEXT NOT NULL,
  "employmentAssignmentId" TEXT NOT NULL,
  "supervisorAssignmentId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_assignment_performance_responsibilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_performance_responsibility_period_check" CHECK (
    "effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"
  ),
  CONSTRAINT "hr_performance_responsibility_reason_check" CHECK (char_length(btrim("reason")) >= 8)
);

CREATE UNIQUE INDEX "hr_perf_resp_assignment_from_key"
  ON "hr_assignment_performance_responsibilities"("employmentAssignmentId", "effectiveFrom");
CREATE INDEX "hr_perf_resp_assignment_period_idx"
  ON "hr_assignment_performance_responsibilities"("employmentAssignmentId", "effectiveFrom", "effectiveTo");
CREATE INDEX "hr_perf_resp_supervisor_period_idx"
  ON "hr_assignment_performance_responsibilities"("supervisorAssignmentId", "effectiveFrom", "effectiveTo");

ALTER TABLE "hr_assignment_performance_responsibilities"
  ADD CONSTRAINT "hr_assignment_performance_responsibilities_employmentAssignmentId_fkey"
  FOREIGN KEY ("employmentAssignmentId") REFERENCES "hr_employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "hr_assignment_performance_responsibilities_supervisorAssignmentId_fkey"
  FOREIGN KEY ("supervisorAssignmentId") REFERENCES "hr_employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION hr_guard_performance_responsibility_period()
RETURNS trigger AS $$
BEGIN
  IF NEW."employmentAssignmentId" = NEW."supervisorAssignmentId" THEN
    RAISE EXCEPTION 'performance responsibility cannot be self-referential';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "hr_assignment_performance_responsibilities" existing
    WHERE existing."employmentAssignmentId" = NEW."employmentAssignmentId"
      AND existing."id" <> NEW."id"
      AND existing."effectiveFrom" < COALESCE(NEW."effectiveTo", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < COALESCE(existing."effectiveTo", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION 'overlapping performance responsibility periods are not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hr_performance_responsibility_period_guard
BEFORE INSERT OR UPDATE ON "hr_assignment_performance_responsibilities"
FOR EACH ROW EXECUTE FUNCTION hr_guard_performance_responsibility_period();
