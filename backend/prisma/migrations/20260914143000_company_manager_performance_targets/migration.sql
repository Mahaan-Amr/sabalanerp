DELETE FROM "hr_feature_access_grants" grant_row
USING (
  SELECT "userId" FROM "hr_business_authority_grants"
  WHERE "authorityCode"::text = 'HR_MANAGER' AND "status" = 'ACTIVE'
  UNION
  SELECT "userId" FROM "hr_hiring_authorities"
  WHERE "authority"::text = 'HR_MANAGER' AND "isActive" = true
) holder
WHERE grant_row."userId" = holder."userId"
  AND grant_row."featureCode" = 'MANAGE_PERFORMANCE_PROFILES'
  AND grant_row."stableKey" LIKE 'seven-level-performance:%';

WITH company_holders AS (
  SELECT "userId", "effectiveFrom", "effectiveTo" FROM "hr_business_authority_grants"
  WHERE "authorityCode"::text = 'COMPANY_MANAGER' AND "status" = 'ACTIVE'
  UNION ALL
  SELECT "userId", "createdAt", "expiresAt" FROM "hr_hiring_authorities"
  WHERE "authority"::text = 'COMPANY_MANAGER' AND "isActive" = true
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'company-performance-targets-' || md5("userId"),
  'company-performance-targets:' || "userId",
  "userId", 'MANAGE_PERFORMANCE_PROFILES', 'ADMIN'::"HrAccessLevel", 'ACTIVE'::"HrGrantStatus",
  MIN("effectiveFrom"), CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END,
  'Company Manager owns Job and Position performance targets', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM company_holders
GROUP BY "userId"
ON CONFLICT ("stableKey") DO UPDATE SET
  "status" = 'ACTIVE'::"HrGrantStatus", "level" = 'ADMIN'::"HrAccessLevel", "updatedAt" = CURRENT_TIMESTAMP;
