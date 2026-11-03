-- Retire the unsupported multi-actor schedule approval flow and grant existing
-- Company Managers the same direct schedule capability as HR managers/processors.
WITH company_managers AS (
  SELECT "userId", MIN("effectiveFrom") AS effective_from,
         CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END AS effective_to
  FROM (
    SELECT "userId", "effectiveFrom", "effectiveTo"
    FROM "hr_business_authority_grants"
    WHERE "authorityCode"::text = 'COMPANY_MANAGER'
      AND "status" = 'ACTIVE'
      AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
    UNION ALL
    SELECT "userId", "createdAt", "expiresAt"
    FROM "hr_hiring_authorities"
    WHERE "authority"::text = 'COMPANY_MANAGER'
      AND "isActive" = true
      AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
  ) holders
  GROUP BY "userId"
), schedule_grants(feature_code, grant_level) AS (
  VALUES
    ('PERSONNEL', 'VIEW'::"HrAccessLevel"),
    ('MANAGE_PERSONNEL_SCHEDULE', 'EDIT'::"HrAccessLevel")
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status",
  "effectiveFrom", "effectiveTo", "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'hr-direct-schedule-' || md5(manager."userId" || ':' || schedule_grant.feature_code),
  'hr-direct-schedule:' || manager."userId" || ':' || schedule_grant.feature_code,
  manager."userId", schedule_grant.feature_code, schedule_grant.grant_level, 'ACTIVE'::"HrGrantStatus",
  manager.effective_from, manager.effective_to,
  'Direct Personnel schedule management policy', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM company_managers manager
CROSS JOIN schedule_grants schedule_grant
ON CONFLICT ("stableKey") DO UPDATE SET
  "level" = EXCLUDED."level",
  "status" = 'ACTIVE'::"HrGrantStatus",
  "effectiveTo" = EXCLUDED."effectiveTo",
  "reason" = EXCLUDED."reason",
  "provenanceVersion" = 3,
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "hr_work_schedule_changes"
SET "status" = 'CANCELLED'::"HrWorkScheduleChangeStatus",
    "returnedAt" = CURRENT_TIMESTAMP,
    "returnReason" = 'گردش قدیمی برنامه کاری با فعال‌شدن ثبت مستقیم بسته شد.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" IN (
  'PROPOSED'::"HrWorkScheduleChangeStatus",
  'DRAFT'::"HrWorkScheduleChangeStatus",
  'SUBMITTED'::"HrWorkScheduleChangeStatus",
  'RETURNED'::"HrWorkScheduleChangeStatus"
);
