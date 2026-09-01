INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT
  'hr-feature-' || lower(replace(source."code", '_', '-')),
  source."code",
  'HUMAN_RESOURCES',
  1,
  source."displayName",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (VALUES
  ('MANAGE_PERFORMANCE_POLICY', 'مدیریت و انتشار سیاست عملکرد'),
  ('MANAGE_PERFORMANCE_CYCLE', 'مدیریت چرخه و مهلت ارزیابی عملکرد'),
  ('SUBMIT_PERFORMANCE_EVALUATION', 'ارسال ارزیابی عملکرد سرپرست'),
  ('REVIEW_PERFORMANCE_EVALUATION', 'بررسی ارزیابی عملکرد'),
  ('VIEW_PERFORMANCE_HISTORY', 'مشاهده سابقه محرمانه عملکرد'),
  ('VIEW_PERFORMANCE_BADGE_LIST', 'مشاهده سطح عملکرد در فهرست پرسنل'),
  ('VIEW_PERFORMANCE_ANALYTICS', 'مشاهده تحلیل تجمیعی عملکرد'),
  ('VIEW_NAMED_PERFORMANCE_RANKING', 'مشاهده تحلیل و رتبه‌بندی نام‌دار عملکرد'),
  ('VIEW_EVALUATOR_CALIBRATION', 'مشاهده کالیبراسیون ارزیاب'),
  ('REQUEST_PERFORMANCE_EXPORT', 'درخواست خروجی محرمانه عملکرد'),
  ('VIEW_PERFORMANCE_AUDIT', 'مشاهده حسابرسی عملکرد'),
  ('MANAGE_PERFORMANCE_RETENTION', 'مدیریت نگهداری و محدودسازی شواهد عملکرد'),
  ('CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF', 'ایجاد واگذاری پیامد عملکرد'),
  ('MANAGE_PERFORMANCE_ROLLOUT', 'مدیریت مرحله و جامعه فعال‌سازی عملکرد'),
  ('PAUSE_PERFORMANCE_EVALUATION', 'توقف ایمن ارزیابی عملکرد')
) AS source("code", "displayName")
WHERE EXISTS (SELECT 1 FROM "hr_workspace_catalogs" WHERE "code" = 'HUMAN_RESOURCES')
ON CONFLICT ("code") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
