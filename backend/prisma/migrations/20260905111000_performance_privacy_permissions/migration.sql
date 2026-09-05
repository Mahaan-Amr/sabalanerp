INSERT INTO hr_feature_catalogs ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-' || lower(replace(source.code,'_','-')), source.code, 'HUMAN_RESOURCES', 1, source.label, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
('VIEW_PERFORMANCE_PRIVACY_CASE','مشاهده پرونده حریم خصوصی عملکرد'),
('ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE','اعلام دریافت درخواست حریم خصوصی عملکرد'),
('VERIFY_PERFORMANCE_PRIVACY_IDENTITY','احراز هویت درخواست حریم خصوصی عملکرد'),
('DECIDE_PERFORMANCE_PRIVACY_ACCESS','تصمیم دسترسی حریم خصوصی عملکرد'),
('DECIDE_PERFORMANCE_PRIVACY_CORRECTION','تصمیم اصلاح حریم خصوصی عملکرد'),
('DECIDE_PERFORMANCE_ERASURE','تصمیم حذف مجاز شواهد عملکرد'),
('RESTRICT_PERFORMANCE_EVIDENCE','محدودسازی شواهد عملکرد'),
('RELEASE_PERFORMANCE_RESTRICTION','رفع محدودسازی شواهد عملکرد'),
('PLACE_PERFORMANCE_LEGAL_HOLD','ایجاد توقف نگهداری عملکرد'),
('RELEASE_PERFORMANCE_LEGAL_HOLD','تصویب رفع توقف نگهداری عملکرد')) source(code,label)
WHERE EXISTS (SELECT 1 FROM hr_workspace_catalogs WHERE code = 'HUMAN_RESOURCES')
ON CONFLICT (code) DO NOTHING;
