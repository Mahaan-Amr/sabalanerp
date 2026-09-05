ALTER TABLE "hr_assignment_performance_responsibilities"
  ADD COLUMN "allocationPercent" DECIMAL(5,2);

UPDATE "hr_assignment_performance_responsibilities" responsibility
SET "allocationPercent" = assignment."performanceAllocationPercent"
FROM "hr_employment_assignments" assignment
WHERE assignment."id" = responsibility."employmentAssignmentId"
  AND assignment."performanceAllocationPercent" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "hr_assignment_performance_responsibilities" WHERE "allocationPercent" IS NULL
  ) THEN
    RAISE EXCEPTION 'explicit performance allocation is required before responsibility history can be promoted';
  END IF;
END;
$$;

ALTER TABLE "hr_assignment_performance_responsibilities"
  ALTER COLUMN "allocationPercent" SET NOT NULL,
  ADD CONSTRAINT "hr_performance_responsibility_allocation_check" CHECK (
    "allocationPercent" > 0 AND "allocationPercent" <= 100
  );
