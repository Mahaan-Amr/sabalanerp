WITH pending AS (
  SELECT
    snapshot."id",
    snapshot."createdAt",
    snapshot."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran' AS local_proposed
  FROM "hr_compensation_snapshots" snapshot
  WHERE snapshot."payrollReviewStatus" = 'PENDING'
    AND snapshot."verificationDueAt" IS NULL
), ranked_workdays AS (
  SELECT
    pending."id",
    pending.local_proposed,
    candidate.day,
    ROW_NUMBER() OVER (PARTITION BY pending."id" ORDER BY candidate.day) AS workday_number
  FROM pending
  CROSS JOIN LATERAL generate_series(
    pending.local_proposed::date + 1,
    pending.local_proposed::date + 30,
    interval '1 day'
  ) AS candidate(day)
  WHERE EXTRACT(DOW FROM candidate.day) <> 5
    AND NOT EXISTS (
      SELECT 1
      FROM "sabalan_calendar_entries" holiday
      WHERE holiday."isActive" = TRUE
        AND holiday."isHoliday" = TRUE
        AND (holiday."date" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tehran')::date = candidate.day::date
    )
), third_workday AS (
  SELECT "id", local_proposed, day
  FROM ranked_workdays
  WHERE workday_number = 3
)
UPDATE "hr_compensation_snapshots" snapshot
SET "verificationDueAt" = (
  third_workday.day::date + third_workday.local_proposed::time
) AT TIME ZONE 'Asia/Tehran' AT TIME ZONE 'UTC'
FROM third_workday
WHERE snapshot."id" = third_workday."id";
