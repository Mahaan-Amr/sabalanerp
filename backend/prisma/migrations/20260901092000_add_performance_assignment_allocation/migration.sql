ALTER TABLE "hr_employment_assignments"
  ADD COLUMN "performanceAllocationPercent" DECIMAL(5,2),
  ADD CONSTRAINT "hr_assignment_performance_allocation_check" CHECK (
    "performanceAllocationPercent" IS NULL
    OR ("performanceAllocationPercent" > 0 AND "performanceAllocationPercent" <= 100)
  );
