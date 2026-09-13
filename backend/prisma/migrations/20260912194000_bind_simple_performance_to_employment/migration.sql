ALTER TABLE "simple_performance_evaluations"
  ADD COLUMN "employmentRelationshipId" TEXT,
  ADD COLUMN "employmentBindingStatus" TEXT NOT NULL DEFAULT 'BOUND';

UPDATE "simple_performance_evaluations" evaluation
SET "employmentRelationshipId" = (
  SELECT candidate."id"
  FROM "hr_employment_relationships" candidate
  WHERE candidate."personnelId" = evaluation."personnelId"
    AND candidate."effectiveFrom" < evaluation."evaluationDate" + INTERVAL '1 day'
    AND (candidate."effectiveTo" IS NULL OR candidate."effectiveTo" >= evaluation."evaluationDate")
  ORDER BY candidate."effectiveFrom" DESC, candidate."createdAt" DESC
  LIMIT 1
) WHERE (
  SELECT COUNT(*)
  FROM "hr_employment_relationships" candidate
  WHERE candidate."personnelId" = evaluation."personnelId"
    AND candidate."effectiveFrom" < evaluation."evaluationDate" + INTERVAL '1 day'
    AND (candidate."effectiveTo" IS NULL OR candidate."effectiveTo" >= evaluation."evaluationDate")
) = 1;

UPDATE "simple_performance_evaluations"
SET "employmentBindingStatus" = 'LEGACY_UNRESOLVED'
WHERE "employmentRelationshipId" IS NULL;

ALTER TABLE "simple_performance_evaluations"
  ALTER COLUMN "score" TYPE DECIMAL(38,18);

ALTER TABLE "simple_performance_values"
  ALTER COLUMN "score" TYPE DECIMAL(38,18);

UPDATE "simple_performance_values" value
SET "score" = TRUNC(CASE
  WHEN indicator."direction" = 'HIGHER_IS_BETTER'
    THEN LEAST(100::DECIMAL, value."actual" / indicator."target" * 100)
  WHEN indicator."target" = 0
    THEN CASE WHEN value."actual" = 0 THEN 100::DECIMAL ELSE 0::DECIMAL END
  WHEN value."actual" = 0
    THEN 100::DECIMAL
  ELSE LEAST(100::DECIMAL, indicator."target" / value."actual" * 100)
END, 18)
FROM "simple_performance_indicators" indicator
WHERE indicator."id" = value."indicatorId";

INSERT INTO "simple_performance_audits" (
  "id", "evaluationId", "personnelId", "actorUserId", "eventType", "details", "createdAt"
)
SELECT
  'migration-score-' || evaluation."id",
  evaluation."id",
  evaluation."personnelId",
  'system-migration',
  'SCORE_PRECISION_RECALCULATED',
  jsonb_build_object(
    'previousScore', evaluation."score",
    'previousLevelCode', evaluation."levelCode",
    'calculatedScore', calculated."score"
  ),
  CURRENT_TIMESTAMP
FROM "simple_performance_evaluations" evaluation
JOIN (
  SELECT value."evaluationId", SUM(value."score" * indicator."weightPercent" / 100) AS "score"
  FROM "simple_performance_values" value
  JOIN "simple_performance_indicators" indicator ON indicator."id" = value."indicatorId"
  GROUP BY value."evaluationId"
) calculated ON calculated."evaluationId" = evaluation."id"
WHERE evaluation."status" = 'FINAL'
  AND evaluation."score" IS DISTINCT FROM calculated."score";

INSERT INTO "simple_performance_audits" (
  "id", "evaluationId", "personnelId", "actorUserId", "eventType", "details", "createdAt"
)
SELECT
  'migration-binding-' || evaluation."id",
  evaluation."id",
  evaluation."personnelId",
  'system-migration',
  'EMPLOYMENT_BINDING_UNRESOLVED',
  jsonb_build_object('matchingRelationshipCount', (
    SELECT COUNT(*)
    FROM "hr_employment_relationships" relationship
    WHERE relationship."personnelId" = evaluation."personnelId"
      AND relationship."effectiveFrom" < evaluation."evaluationDate" + INTERVAL '1 day'
      AND (relationship."effectiveTo" IS NULL OR relationship."effectiveTo" >= evaluation."evaluationDate")
  )),
  CURRENT_TIMESTAMP
FROM "simple_performance_evaluations" evaluation
WHERE evaluation."employmentRelationshipId" IS NULL;

INSERT INTO "simple_performance_audits" (
  "id", "evaluationId", "personnelId", "actorUserId", "eventType", "details", "createdAt"
)
SELECT
  'migration-binding-added-' || evaluation."id",
  evaluation."id",
  evaluation."personnelId",
  'system-migration',
  'EMPLOYMENT_BINDING_ADDED',
  jsonb_build_object('employmentRelationshipId', evaluation."employmentRelationshipId"),
  CURRENT_TIMESTAMP
FROM "simple_performance_evaluations" evaluation
WHERE evaluation."employmentRelationshipId" IS NOT NULL;

UPDATE "simple_performance_evaluations" evaluation
SET "score" = TRUNC(calculated."score", 18)
FROM (
  SELECT value."evaluationId", SUM(value."score" * indicator."weightPercent" / 100) AS "score"
  FROM "simple_performance_values" value
  JOIN "simple_performance_indicators" indicator ON indicator."id" = value."indicatorId"
  GROUP BY value."evaluationId"
) calculated
WHERE evaluation."id" = calculated."evaluationId"
  AND evaluation."status" = 'FINAL';

UPDATE "simple_performance_evaluations"
SET "levelCode" = CASE
  WHEN "score" = 100 THEN 'OUTSTANDING'
  WHEN "score" >= 90 THEN 'EXCEEDS_EXPECTATIONS'
  WHEN "score" >= 75 THEN 'MEETS_EXPECTATIONS'
  WHEN "score" >= 60 THEN 'NEEDS_IMPROVEMENT'
  ELSE 'URGENT_IMPROVEMENT'
END
WHERE "status" = 'FINAL' AND "score" IS NOT NULL;

CREATE INDEX "simple_performance_evaluations_employmentRelationshipId_status_finalizedAt_idx"
  ON "simple_performance_evaluations"("employmentRelationshipId", "status", "finalizedAt");

CREATE UNIQUE INDEX "hr_employment_relationships_id_personnelId_key"
  ON "hr_employment_relationships"("id", "personnelId");

ALTER TABLE "simple_performance_evaluations"
  ADD CONSTRAINT "simple_performance_evaluations_employmentRelationshipId_fkey"
  FOREIGN KEY ("employmentRelationshipId", "personnelId") REFERENCES "hr_employment_relationships"("id", "personnelId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "simple_performance_evaluations"
  ADD CONSTRAINT "simple_performance_evaluations_employment_binding_check"
  CHECK (
    ("employmentBindingStatus" = 'BOUND' AND "employmentRelationshipId" IS NOT NULL)
    OR ("employmentBindingStatus" = 'LEGACY_UNRESOLVED' AND "employmentRelationshipId" IS NULL)
  );
