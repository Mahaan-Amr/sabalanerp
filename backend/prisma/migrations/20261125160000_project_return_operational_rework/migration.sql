CREATE TYPE "ProjectReturnOperationStatus" AS ENUM ('ACTIVE', 'REWORK_REQUESTED', 'RETURNED_TO_LOGISTICS', 'CANCELLED');
CREATE TYPE "ProjectReturnOperationKind" AS ENUM ('EDITED', 'CANCELLED', 'REWORK_REQUESTED', 'RETURNED_TO_LOGISTICS');

ALTER TABLE "project_return_cases" ADD COLUMN "operationStatus" "ProjectReturnOperationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "project_return_operations" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "kind" "ProjectReturnOperationKind" NOT NULL,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedReservationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "clearedDraftNumber" INTEGER,
  CONSTRAINT "project_return_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_return_operations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "project_return_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_return_operations_caseId_versionId_fkey" FOREIGN KEY ("caseId", "versionId") REFERENCES "project_return_versions"("caseId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "project_return_operations_caseId_occurredAt_idx" ON "project_return_operations"("caseId", "occurredAt");
