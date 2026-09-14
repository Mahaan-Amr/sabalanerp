INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt") VALUES
('hr-feature-view-performance-evaluations', 'VIEW_PERFORMANCE_EVALUATIONS', 'HUMAN_RESOURCES', 1, 'مشاهده ارزیابی‌های عملکرد', true, now(), now()),
('hr-feature-evaluate-direct-reports', 'EVALUATE_DIRECT_REPORTS', 'HUMAN_RESOURCES', 1, 'ارزیابی افراد تحت سرپرستی', true, now(), now()),
('hr-feature-evaluate-all-personnel', 'EVALUATE_ALL_PERSONNEL', 'HUMAN_RESOURCES', 1, 'ارزیابی همه پرسنل', true, now(), now()),
('hr-feature-manage-performance-profiles', 'MANAGE_PERFORMANCE_PROFILES', 'HUMAN_RESOURCES', 1, 'مدیریت الگوهای ارزیابی', true, now(), now())
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = now();

UPDATE "hr_feature_catalogs"
SET "displayName" = 'مشاهده نشان در فهرست پرسنل', "isActive" = true, "updatedAt" = now()
WHERE "code" = 'VIEW_PERFORMANCE_BADGE_LIST';
