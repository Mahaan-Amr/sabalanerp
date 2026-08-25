-- Company Managers need the HR workspace entry point in addition to the
-- explicit Personnel and schedule-action grants created by the prior migration.
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
)
INSERT INTO "hr_workspace_access_grants" (
  "id", "stableKey", "userId", "workspaceCode", "level", "status",
  "effectiveFrom", "effectiveTo", "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'hr-direct-schedule-workspace-' || md5(manager."userId"),
  'hr-direct-schedule-workspace:' || manager."userId",
  manager."userId", 'HUMAN_RESOURCES', 'VIEW'::"HrAccessLevel", 'ACTIVE'::"HrGrantStatus",
  manager.effective_from, manager.effective_to,
  'Company Manager Personnel schedule access', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM company_managers manager
ON CONFLICT ("stableKey") DO UPDATE SET
  "level" = EXCLUDED."level",
  "status" = 'ACTIVE'::"HrGrantStatus",
  "effectiveTo" = EXCLUDED."effectiveTo",
  "reason" = EXCLUDED."reason",
  "provenanceVersion" = 3,
  "updatedAt" = CURRENT_TIMESTAMP;
