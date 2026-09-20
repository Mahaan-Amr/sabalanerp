WITH permissions(code, display_name) AS (
  VALUES
    ('MANAGE_PERFORMANCE_SURVEYS', 'مدیریت نظرسنجی رفتاری'),
    ('RESPOND_PERFORMANCE_SURVEYS', 'پاسخ به نظرسنجی رفتاری'),
    ('ENTER_PERFORMANCE_EVIDENCE', 'ثبت شواهد کمی ارزیابی'),
    ('FINALIZE_PERFORMANCE_RESULTS', 'نهایی‌سازی نتیجه ارزیابی'),
    ('VIEW_RAW_PERFORMANCE_SURVEY', 'مشاهده محرمانه پاسخ خام نظرسنجی')
)
INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-action-' || md5(code), code, 'HUMAN_RESOURCES', 1, display_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permissions
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

WITH authority_actions(authority_code, feature_code, access_level) AS (
  VALUES
    ('HR_PROCESSOR', 'VIEW_PERFORMANCE_BADGE_LIST', 'VIEW'::"HrAccessLevel"),
    ('HR_PROCESSOR', 'VIEW_PERFORMANCE_EVALUATIONS', 'VIEW'::"HrAccessLevel"),
    ('HR_PROCESSOR', 'ENTER_PERFORMANCE_EVIDENCE', 'EDIT'::"HrAccessLevel"),
    ('HR_MANAGER', 'VIEW_PERFORMANCE_BADGE_LIST', 'VIEW'::"HrAccessLevel"),
    ('HR_MANAGER', 'VIEW_PERFORMANCE_EVALUATIONS', 'VIEW'::"HrAccessLevel"),
    ('HR_MANAGER', 'EVALUATE_ALL_PERSONNEL', 'EDIT'::"HrAccessLevel"),
    ('HR_MANAGER', 'MANAGE_PERFORMANCE_PROFILES', 'ADMIN'::"HrAccessLevel"),
    ('HR_MANAGER', 'MANAGE_PERFORMANCE_SURVEYS', 'ADMIN'::"HrAccessLevel"),
    ('HR_MANAGER', 'FINALIZE_PERFORMANCE_RESULTS', 'ADMIN'::"HrAccessLevel"),
    ('HR_MANAGER', 'VIEW_RAW_PERFORMANCE_SURVEY', 'ADMIN'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'VIEW_PERFORMANCE_BADGE_LIST', 'VIEW'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'VIEW_PERFORMANCE_EVALUATIONS', 'VIEW'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'MANAGE_PERFORMANCE_SURVEYS', 'ADMIN'::"HrAccessLevel")
), authority_holders AS (
  SELECT "userId", "authorityCode"::text AS authority_code, "effectiveFrom", "effectiveTo"
  FROM "hr_business_authority_grants"
  WHERE "status" = 'ACTIVE' AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
  UNION
  SELECT "userId", "authority"::text, "createdAt", "expiresAt"
  FROM "hr_hiring_authorities"
  WHERE "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
), expanded AS (
  SELECT DISTINCT holder."userId", mapping.feature_code, mapping.access_level, holder."effectiveFrom", holder."effectiveTo"
  FROM authority_holders holder
  JOIN authority_actions mapping ON mapping.authority_code = holder.authority_code
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'seven-level-performance-' || md5("userId" || ':' || feature_code),
  'seven-level-performance:' || "userId" || ':' || feature_code,
  "userId", feature_code, access_level, 'ACTIVE'::"HrGrantStatus", MIN("effectiveFrom"),
  CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END,
  'Seven-level personnel performance rollout', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM expanded
GROUP BY "userId", feature_code, access_level
ON CONFLICT ("stableKey") DO NOTHING;
