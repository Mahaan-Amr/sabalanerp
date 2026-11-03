-- Correct capabilities introduced after the initial #272 cutover and preserve
-- the catalog-declared minimum level for already migrated grants.
WITH permissions(code, display_name) AS (
  VALUES
    ('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', 'مدیریت الزامات پیش از استخدام'),
    ('MANAGE_PERSONNEL_SCHEDULE', 'مدیریت برنامه کار پرسنل')
)
INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-action-' || md5(code), code, 'HUMAN_RESOURCES', 2, display_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permissions
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "version" = 2, "updatedAt" = CURRENT_TIMESTAMP;

WITH authority_actions(authority_code, feature_code, required_level) AS (
  VALUES
    ('HR_PROCESSOR', 'MANAGE_PERSONNEL_SCHEDULE', 'EDIT'::"HrAccessLevel"),
    ('HR_MANAGER', 'MANAGE_PERSONNEL_SCHEDULE', 'EDIT'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', 'EDIT'::"HrAccessLevel")
), legacy_holders AS (
  SELECT "userId", "authorityCode"::text AS authority_code, "effectiveFrom", "effectiveTo"
  FROM "hr_business_authority_grants"
  WHERE "status" = 'ACTIVE' AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
  UNION
  SELECT "userId", "authority"::text, "createdAt", "expiresAt"
  FROM "hr_hiring_authorities"
  WHERE "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
), expanded AS (
  SELECT holder."userId", mapping.feature_code, mapping.required_level,
         MIN(holder."effectiveFrom") AS effective_from,
         CASE WHEN BOOL_OR(holder."effectiveTo" IS NULL) THEN NULL ELSE MAX(holder."effectiveTo") END AS effective_to
  FROM legacy_holders holder
  JOIN authority_actions mapping ON mapping.authority_code = holder.authority_code
  GROUP BY holder."userId", mapping.feature_code, mapping.required_level
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT 'hr-action-grant-' || md5("userId" || ':' || feature_code),
       'hr-action-cutover:' || "userId" || ':' || feature_code,
       "userId", feature_code, required_level, 'ACTIVE'::"HrGrantStatus", effective_from, effective_to,
       'Issue #272 cutover capability correction', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM expanded
ON CONFLICT ("stableKey") DO NOTHING;

UPDATE "hr_feature_access_grants"
SET "level" = 'ADMIN'::"HrAccessLevel", "updatedAt" = CURRENT_TIMESTAMP
WHERE "stableKey" LIKE 'hr-action-cutover:%'
  AND "featureCode" IN ('MANAGE_INITIAL_INTERVIEW_CRITERIA', 'ARCHIVE_RECRUITMENT_CASE')
  AND "level" <> 'ADMIN'::"HrAccessLevel";

UPDATE "hr_feature_access_grants"
SET "level" = 'VIEW'::"HrAccessLevel", "updatedAt" = CURRENT_TIMESTAMP
WHERE "stableKey" LIKE 'hr-action-cutover:%'
  AND "featureCode" LIKE 'VIEW_%'
  AND "level" <> 'VIEW'::"HrAccessLevel";
