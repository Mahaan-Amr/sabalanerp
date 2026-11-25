ALTER TABLE "project_return_cases"
  ALTER COLUMN "guardVisitId" DROP NOT NULL,
  ALTER COLUMN "intakeHash" DROP NOT NULL,
  ADD COLUMN "legacyFinalizationId" TEXT,
  ADD CONSTRAINT "project_return_case_source_check"
    CHECK (num_nonnulls("guardVisitId", "legacyFinalizationId") = 1
       AND ("guardVisitId" IS NULL) = ("intakeHash" IS NULL)),
  ADD CONSTRAINT "project_return_cases_legacyFinalizationId_fkey"
    FOREIGN KEY ("legacyFinalizationId") REFERENCES "stone_return_finalizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "project_return_cases_legacyFinalizationId_key"
  ON "project_return_cases"("legacyFinalizationId");

ALTER TABLE "project_return_versions"
  ALTER COLUMN "submittedAt" DROP NOT NULL,
  ALTER COLUMN "submittedAt" DROP DEFAULT,
  ALTER COLUMN "submittedBy" DROP NOT NULL,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "assignedBy" TEXT,
  ADD CONSTRAINT "project_return_version_action_check" CHECK (
    (num_nonnulls("submittedAt", "submittedBy") = 2 AND num_nonnulls("assignedAt", "assignedBy") = 0)
    OR
    (num_nonnulls("submittedAt", "submittedBy") = 0 AND num_nonnulls("assignedAt", "assignedBy") = 2)
  );
