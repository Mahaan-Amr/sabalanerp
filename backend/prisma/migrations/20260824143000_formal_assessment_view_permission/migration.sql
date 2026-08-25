WITH permission(code, display_name) AS (
  VALUES ('VIEW_FORMAL_ASSESSMENT_RESULTS', 'مشاهده نتایج ارزیابی‌های رسمی')
)
INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-action-' || md5(code), code, 'HUMAN_RESOURCES', 1, display_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permission
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

WITH authority_actions(authority_code, feature_code, access_level) AS (
  VALUES
    ('HR_MANAGER', 'VIEW_FORMAL_ASSESSMENT_RESULTS', 'VIEW'::"HrAccessLevel"),
    ('COMPANY_MANAGER', 'VIEW_FORMAL_ASSESSMENT_RESULTS', 'VIEW'::"HrAccessLevel")
), legacy_holders AS (
  SELECT "userId", "authorityCode"::text AS authority_code, "effectiveFrom", "effectiveTo"
  FROM "hr_business_authority_grants"
  WHERE "status" = 'ACTIVE' AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
  UNION ALL
  SELECT "userId", "authority"::text, "createdAt", "expiresAt"
  FROM "hr_hiring_authorities"
  WHERE "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
), expanded AS (
  SELECT DISTINCT holder."userId", mapping.feature_code, mapping.access_level, holder."effectiveFrom", holder."effectiveTo"
  FROM legacy_holders holder
  JOIN authority_actions mapping ON mapping.authority_code = holder.authority_code
  WHERE NOT EXISTS (
    SELECT 1 FROM "hr_feature_access_grants" existing
    WHERE existing."userId" = holder."userId" AND existing."featureCode" = mapping.feature_code
  )
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'hr-formal-view-grant-' || md5("userId" || ':' || feature_code),
  'hr-formal-view:' || "userId" || ':' || feature_code,
  "userId", feature_code, access_level, 'ACTIVE'::"HrGrantStatus", MIN("effectiveFrom"),
  CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END,
  'Controlled formal-assessment view permission migration', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM expanded
GROUP BY "userId", feature_code, access_level
ON CONFLICT ("stableKey") DO NOTHING;
