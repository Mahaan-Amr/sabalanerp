CREATE TABLE "performance_readiness_runs" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "measurementFrom" TIMESTAMP(3) NOT NULL,
  "measurementTo" TIMESTAMP(3) NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "cursorAssignmentId" TEXT,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "blockedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "driftDetected" BOOLEAN NOT NULL DEFAULT false,
  "requestedByUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_readiness_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_readiness_runs_period_check" CHECK ("measurementFrom" < "measurementTo"),
  CONSTRAINT "performance_readiness_runs_counts_check" CHECK (
    "sourceCount" >= 0 AND "appliedCount" >= 0 AND "blockedCount" >= 0 AND "failedCount" >= 0
  )
);

CREATE UNIQUE INDEX "performance_readiness_runs_stableKey_key" ON "performance_readiness_runs"("stableKey");
CREATE INDEX "performance_readiness_runs_status_startedAt_idx" ON "performance_readiness_runs"("status", "startedAt");

CREATE TABLE "performance_readiness_records" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "employmentAssignmentId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "blockerCode" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "lastErrorCode" TEXT,
  "evaluationId" TEXT,
  "sectionId" TEXT,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_readiness_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_readiness_records_attempt_check" CHECK ("attemptCount" > 0),
  CONSTRAINT "performance_readiness_records_status_check" CHECK ("status" IN ('APPLIED', 'BLOCKED', 'FAILED')),
  CONSTRAINT "performance_readiness_records_run_fkey" FOREIGN KEY ("runId") REFERENCES "performance_readiness_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_readiness_records_assignment_fkey" FOREIGN KEY ("employmentAssignmentId") REFERENCES "hr_employment_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_readiness_records_evaluation_fkey" FOREIGN KEY ("evaluationId") REFERENCES "performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_readiness_records_section_fkey" FOREIGN KEY ("sectionId") REFERENCES "performance_evaluation_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "performance_readiness_records_runId_employmentAssignmentId_key" ON "performance_readiness_records"("runId", "employmentAssignmentId");
CREATE INDEX "performance_readiness_records_status_processedAt_idx" ON "performance_readiness_records"("status", "processedAt");

ALTER TABLE "performance_evaluation_sections"
  ADD COLUMN "originalSubmissionDueAt" TIMESTAMP(3),
  ADD COLUMN "submissionDueAt" TIMESTAMP(3),
  ADD COLUMN "reviewDueAt" TIMESTAMP(3),
  ADD COLUMN "windowClosedAt" TIMESTAMP(3),
  ADD COLUMN "extensionCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "performance_section_extension_count_check" CHECK ("extensionCount" >= 0),
  ADD CONSTRAINT "performance_section_due_order_check" CHECK (
    "originalSubmissionDueAt" IS NULL OR "submissionDueAt" IS NULL OR "submissionDueAt" >= "originalSubmissionDueAt"
  );
