ALTER TABLE "simple_performance_evaluations"
  ADD COLUMN "periodKey" TEXT,
  ADD COLUMN "periodLabelFa" TEXT,
  ADD COLUMN "measurementFrom" DATE,
  ADD COLUMN "measurementTo" DATE,
  ADD COLUMN "effectiveDays" INTEGER,
  ADD COLUMN "proposedAt" TIMESTAMP(3),
  ADD COLUMN "appealDeadline" TIMESTAMP(3),
  ADD COLUMN "appealText" TEXT,
  ADD COLUMN "appealedAt" TIMESTAMP(3),
  ADD COLUMN "appealResolution" TEXT,
  ADD COLUMN "appealResolvedAt" TIMESTAMP(3),
  ADD COLUMN "appealResolvedByUserId" TEXT,
  ADD COLUMN "assignmentSegments" JSONB;

CREATE TABLE "simple_performance_value_revisions" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "oldActual" DECIMAL(18,4),
  "newActual" DECIMAL(18,4) NOT NULL,
  "oldSampleCount" INTEGER,
  "newSampleCount" INTEGER,
  "oldSourceReference" TEXT,
  "newSourceReference" TEXT,
  "reason" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simple_performance_value_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "simple_performance_value_revisions_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "simple_performance_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "simple_performance_value_revisions_evaluationId_indicatorId_version_key" ON "simple_performance_value_revisions"("evaluationId", "indicatorId", "version");
CREATE INDEX "simple_performance_value_revisions_evaluationId_createdAt_idx" ON "simple_performance_value_revisions"("evaluationId", "createdAt");

CREATE TABLE "personnel_behavior_survey_response_revisions" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "commentText" TEXT,
  "answers" JSONB NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_behavior_survey_response_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_behavior_survey_response_revisions_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "personnel_behavior_survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "personnel_behavior_survey_response_revisions_responseId_version_key" ON "personnel_behavior_survey_response_revisions"("responseId", "version");
CREATE INDEX "personnel_behavior_survey_response_revisions_responseId_createdAt_idx" ON "personnel_behavior_survey_response_revisions"("responseId", "createdAt");
