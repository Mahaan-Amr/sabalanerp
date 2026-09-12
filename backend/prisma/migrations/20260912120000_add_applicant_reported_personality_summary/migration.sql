-- New interviews snapshot one protected composite criterion for applicant-reported
-- DISC, BIG FIVE, and EQ summaries. Existing drafts and completed interviews keep
-- their earlier criteria version unchanged.
WITH latest AS (
  SELECT "version", "criteriaJson"
  FROM "hr_interview_criteria_versions"
  ORDER BY "version" DESC
  LIMIT 1
), eligible AS (
  SELECT *
  FROM latest
  WHERE jsonb_typeof("criteriaJson") = 'array'
    AND jsonb_array_length("criteriaJson") >= 17
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements("criteriaJson") AS criterion
      WHERE criterion->>'stableId' = 'personalityTestSummary'
    )
), upgraded_items AS (
  SELECT
    CASE WHEN position <= 17 THEN position ELSE position + 1 END AS new_position,
    jsonb_set(criterion, '{order}', to_jsonb(CASE WHEN position <= 17 THEN position ELSE position + 1 END), true) AS criterion
  FROM eligible
  CROSS JOIN LATERAL jsonb_array_elements("criteriaJson") WITH ORDINALITY AS item(criterion, position)

  UNION ALL

  SELECT 18, jsonb_build_object(
    'stableId', 'personalityTestSummary',
    'title', 'نتایج آزمون‌های DISC، BIG FIVE و EQ',
    'description', NULL,
    'answerType', 'PERSONALITY_TEST_SUMMARY',
    'isActive', true,
    'allowUnassessed', false,
    'order', 18
  )
  FROM eligible
), upgraded AS (
  SELECT jsonb_agg(criterion ORDER BY new_position) AS "criteriaJson"
  FROM upgraded_items
)
INSERT INTO "hr_interview_criteria_versions" (
  "id", "version", "criteriaJson", "publishedByUserId", "publishedAt", "createdAt"
)
SELECT
  'hr-interview-personality-summary-v' || (eligible."version" + 1)::text,
  eligible."version" + 1,
  upgraded."criteriaJson",
  'system:personality-summary-migration',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM eligible
CROSS JOIN upgraded;
