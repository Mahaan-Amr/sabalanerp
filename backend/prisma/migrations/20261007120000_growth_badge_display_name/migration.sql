-- Rename only the display label; keep permission identity and grants intact.
UPDATE "hr_feature_catalogs"
SET "displayName" = 'مشاهده نشان رشد در فهرست پرسنل', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'VIEW_PERFORMANCE_BADGE_LIST';
