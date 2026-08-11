-- #272: action permissions replace live HR authority/responsibility authorization.
-- Legacy rows remain untouched as read-only history.
INSERT INTO "hr_workspace_catalogs" ("id", "code", "version", "displayName", "isActive", "createdAt", "updatedAt")
VALUES ('hr-workspace-human-resources', 'HUMAN_RESOURCES', 2, 'منابع انسانی', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "version" = 2, "updatedAt" = CURRENT_TIMESTAMP;

WITH permissions(code, display_name) AS (
  VALUES
    ('VIEW_INITIAL_INTERVIEW_REPORT', 'مشاهده گزارش مصاحبه اولیه'),
    ('VIEW_FULL_APPLICANT_INFORMATION', 'مشاهده اطلاعات کامل متقاضی'),
    ('VIEW_COMPANY_EVALUATION_RESULTS', 'مشاهده نتایج ارزیابی شرکت'),
    ('RECORD_INITIAL_INTERVIEW', 'ثبت و تکمیل مصاحبه اولیه'),
    ('VIEW_INITIAL_INTERVIEW_CRITERIA', 'مشاهده معیارهای مصاحبه اولیه'),
    ('MANAGE_INITIAL_INTERVIEW_CRITERIA', 'مدیریت و انتشار معیارهای مصاحبه اولیه'),
    ('RECORD_PRELIMINARY_DECISION', 'ثبت تصمیم مقدماتی'),
    ('MANAGE_COMPANY_EVALUATION_PLAN', 'مدیریت برنامه ارزیابی شرکت'),
    ('RECORD_COMPANY_EVALUATION_RESULT', 'ثبت نتیجه ارزیابی شرکت'),
    ('RECORD_FINAL_MANAGEMENT_DECISION', 'ثبت تصمیم نهایی مدیریت'),
    ('MANAGE_RECRUITMENT_CASE', 'مدیریت پرونده استخدام'),
    ('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', 'مدیریت الزامات پیش از استخدام'),
    ('MANAGE_PERSONNEL_SCHEDULE', 'مدیریت برنامه کار پرسنل'),
    ('ARCHIVE_RECRUITMENT_CASE', 'بایگانی و بازیابی پرونده'),
    ('MANAGE_HR_WORK', 'مدیریت کارهای منابع انسانی'),
    ('MANAGE_COMPENSATION', 'مدیریت پیشنهاد و جبران خدمت'),
    ('MANAGE_PAYROLL', 'ثبت و تأیید اطلاعات حقوق'),
    ('MANAGE_FINANCE_EVIDENCE', 'ثبت و تأیید شواهد مالی')
)
INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-action-' || md5(code), code, 'HUMAN_RESOURCES', 2, display_name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM permissions
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "version" = 2, "updatedAt" = CURRENT_TIMESTAMP;

WITH authority_actions(authority_code, feature_code) AS (
  VALUES
    ('HR_PROCESSOR', 'RECORD_INITIAL_INTERVIEW'), ('HR_PROCESSOR', 'VIEW_INITIAL_INTERVIEW_CRITERIA'), ('HR_PROCESSOR', 'RECORD_COMPANY_EVALUATION_RESULT'), ('HR_PROCESSOR', 'VIEW_COMPANY_EVALUATION_RESULTS'), ('HR_PROCESSOR', 'VIEW_FULL_APPLICANT_INFORMATION'), ('HR_PROCESSOR', 'MANAGE_RECRUITMENT_CASE'), ('HR_PROCESSOR', 'MANAGE_PERSONNEL_SCHEDULE'),
    ('HR_MANAGER', 'RECORD_PRELIMINARY_DECISION'), ('HR_MANAGER', 'VIEW_INITIAL_INTERVIEW_REPORT'), ('HR_MANAGER', 'VIEW_INITIAL_INTERVIEW_CRITERIA'), ('HR_MANAGER', 'MANAGE_INITIAL_INTERVIEW_CRITERIA'), ('HR_MANAGER', 'ARCHIVE_RECRUITMENT_CASE'), ('HR_MANAGER', 'MANAGE_HR_WORK'), ('HR_MANAGER', 'MANAGE_RECRUITMENT_CASE'), ('HR_MANAGER', 'MANAGE_PERSONNEL_SCHEDULE'),
    ('COMPANY_MANAGER', 'MANAGE_COMPANY_EVALUATION_PLAN'), ('COMPANY_MANAGER', 'VIEW_INITIAL_INTERVIEW_REPORT'), ('COMPANY_MANAGER', 'VIEW_COMPANY_EVALUATION_RESULTS'), ('COMPANY_MANAGER', 'RECORD_FINAL_MANAGEMENT_DECISION'), ('COMPANY_MANAGER', 'MANAGE_COMPENSATION'), ('COMPANY_MANAGER', 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'),
    ('HR_PAYROLL_PROCESSOR', 'MANAGE_PAYROLL'), ('HR_PAYROLL_MANAGER', 'MANAGE_PAYROLL'),
    ('FINANCE_RECORDER', 'MANAGE_FINANCE_EVIDENCE'), ('FINANCE_MANAGER', 'MANAGE_FINANCE_EVIDENCE')
), legacy_holders AS (
  SELECT "userId", "authorityCode"::text AS authority_code, "effectiveFrom", "effectiveTo"
  FROM "hr_business_authority_grants"
  WHERE "status" = 'ACTIVE' AND ("effectiveTo" IS NULL OR "effectiveTo" > CURRENT_TIMESTAMP)
  UNION
  SELECT "userId", "authority"::text, "createdAt", "expiresAt"
  FROM "hr_hiring_authorities"
  WHERE "isActive" = true AND ("expiresAt" IS NULL OR "expiresAt" > CURRENT_TIMESTAMP)
), expanded AS (
  SELECT DISTINCT holder."userId", mapping.feature_code, holder."effectiveFrom", holder."effectiveTo"
  FROM legacy_holders holder
  JOIN authority_actions mapping ON mapping.authority_code = holder.authority_code
)
INSERT INTO "hr_feature_access_grants" (
  "id", "stableKey", "userId", "featureCode", "level", "status", "effectiveFrom", "effectiveTo",
  "reason", "provenanceVersion", "createdAt", "updatedAt"
)
SELECT
  'hr-action-grant-' || md5("userId" || ':' || feature_code),
  'hr-action-cutover:' || "userId" || ':' || feature_code,
  "userId", feature_code,
  CASE WHEN feature_code IN ('MANAGE_INITIAL_INTERVIEW_CRITERIA', 'ARCHIVE_RECRUITMENT_CASE') THEN 'ADMIN'::"HrAccessLevel"
       WHEN feature_code LIKE 'VIEW_%' THEN 'VIEW'::"HrAccessLevel"
       ELSE 'EDIT'::"HrAccessLevel" END,
  'ACTIVE'::"HrGrantStatus", MIN("effectiveFrom"),
  CASE WHEN BOOL_OR("effectiveTo" IS NULL) THEN NULL ELSE MAX("effectiveTo") END,
  'Issue #272 legacy authority capability migration', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM expanded
GROUP BY "userId", feature_code
ON CONFLICT ("stableKey") DO NOTHING;

CREATE TABLE "hr_interview_criteria_versions" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "criteriaJson" JSONB NOT NULL,
  "publishedByUserId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_interview_criteria_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_interview_criteria_versions_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "hr_interview_criteria_versions_version_key" ON "hr_interview_criteria_versions"("version");

CREATE TABLE "hr_company_evaluation_occurrences" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "occurrenceNumber" INTEGER NOT NULL,
  "subject" TEXT,
  "instructions" TEXT,
  "evidencePolicy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PLANNED',
  "resultEffect" TEXT,
  "resultExplanation" TEXT,
  "resultStorageName" TEXT,
  "resultOriginalName" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "hr_company_evaluation_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hr_company_evaluation_occurrences_number_check" CHECK ("occurrenceNumber" > 0),
  CONSTRAINT "hr_company_evaluation_occurrences_application_fkey" FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hr_company_evaluation_occurrences_application_type_number_key" ON "hr_company_evaluation_occurrences"("applicationId", "type", "occurrenceNumber");
CREATE INDEX "hr_company_evaluation_occurrences_application_status_created_idx" ON "hr_company_evaluation_occurrences"("applicationId", "status", "createdAt");
