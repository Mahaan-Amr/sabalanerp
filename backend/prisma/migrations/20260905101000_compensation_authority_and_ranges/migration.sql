CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "hr_compensation_agreements" ADD CONSTRAINT "hr_compensation_agreements_no_overlap"
  EXCLUDE USING gist (
    "employmentRelationshipId" WITH =,
    tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&
  ) WHERE ("status" IN ('SCHEDULED', 'ACTIVE', 'RETIRED'));

INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-feature-' || lower(replace(code, '_', '-')), code, 'HUMAN_RESOURCES', 1, label, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('REVIEW_PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL', 'کنترل حقوقی مستقل پیامد عملکرد'),
  ('MANAGE_COMPENSATION_AGREEMENTS', 'انتشار توافق جبران خدمت')
) AS permission(code, label)
ON CONFLICT ("code") DO NOTHING;
