INSERT INTO hr_feature_catalogs ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-deliver-performance-personal-summary', 'DELIVER_PERFORMANCE_PERSONAL_SUMMARY', 'HUMAN_RESOURCES', 1,
  'تحویل خلاصه شخصی عملکرد پس از احراز هویت', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM hr_workspace_catalogs WHERE code = 'HUMAN_RESOURCES')
ON CONFLICT ("code") DO NOTHING;
