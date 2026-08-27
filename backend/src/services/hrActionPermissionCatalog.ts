export type HrActionPermissionDefinition = {
  code: string;
  labelFa: string;
  level: 'VIEW' | 'EDIT' | 'ADMIN';
  prerequisites: string[];
};

export const HR_ACTION_PERMISSION_GROUPS: ReadonlyArray<{
  code: string;
  labelFa: string;
  permissions: readonly HrActionPermissionDefinition[];
}> = [
  {
    code: 'CASE_EVIDENCE', labelFa: 'مشاهده پرونده و شواهد', permissions: [
      { code: 'VIEW_INITIAL_INTERVIEW_REPORT', labelFa: 'مشاهده گزارش مصاحبه اولیه', level: 'VIEW', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'VIEW_FULL_APPLICANT_INFORMATION', labelFa: 'مشاهده اطلاعات کامل متقاضی', level: 'VIEW', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'VIEW_COMPANY_EVALUATION_RESULTS', labelFa: 'مشاهده نتایج ارزیابی شرکت', level: 'VIEW', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'VIEW_FORMAL_ASSESSMENT_RESULTS', labelFa: 'مشاهده نتایج ارزیابی‌های رسمی', level: 'VIEW', prerequisites: ['RECRUITMENT_CASES'] },
    ],
  },
  {
    code: 'INITIAL_INTERVIEW', labelFa: 'مصاحبه اولیه', permissions: [
      { code: 'RECORD_INITIAL_INTERVIEW', labelFa: 'ثبت و تکمیل مصاحبه اولیه', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES', 'VIEW_INITIAL_INTERVIEW_CRITERIA'] },
      { code: 'VIEW_INITIAL_INTERVIEW_CRITERIA', labelFa: 'مشاهده معیارهای مصاحبه اولیه', level: 'VIEW', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_INITIAL_INTERVIEW_CRITERIA', labelFa: 'مدیریت و انتشار معیارهای مصاحبه اولیه', level: 'ADMIN', prerequisites: ['VIEW_INITIAL_INTERVIEW_CRITERIA'] },
      { code: 'RECORD_PRELIMINARY_DECISION', labelFa: 'ثبت تصمیم مقدماتی', level: 'EDIT', prerequisites: ['VIEW_INITIAL_INTERVIEW_REPORT'] },
    ],
  },
  {
    code: 'COMPANY_EVALUATION', labelFa: 'ارزیابی‌های شرکت', permissions: [
      { code: 'MANAGE_COMPANY_EVALUATION_PLAN', labelFa: 'مدیریت برنامه ارزیابی شرکت', level: 'EDIT', prerequisites: ['VIEW_INITIAL_INTERVIEW_REPORT', 'VIEW_COMPANY_EVALUATION_RESULTS'] },
      { code: 'RECORD_COMPANY_EVALUATION_RESULT', labelFa: 'ثبت نتیجه ارزیابی شرکت', level: 'EDIT', prerequisites: ['VIEW_COMPANY_EVALUATION_RESULTS'] },
      { code: 'MANAGE_RECRUITMENT_EVALUATOR_SETTINGS', labelFa: 'مدیریت تنظیمات ارزیابان جذب', level: 'ADMIN', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'RECORD_FINAL_MANAGEMENT_DECISION', labelFa: 'ثبت تصمیم نهایی مدیریت', level: 'EDIT', prerequisites: ['VIEW_INITIAL_INTERVIEW_REPORT', 'VIEW_COMPANY_EVALUATION_RESULTS'] },
    ],
  },
  {
    code: 'CASE_ADMINISTRATION', labelFa: 'اداره پرونده و عملیات تکمیلی', permissions: [
      { code: 'MANAGE_RECRUITMENT_CASE', labelFa: 'مدیریت پرونده استخدام', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'REVISE_PLANNED_EMPLOYMENT_START', labelFa: 'اصلاح تاریخ برنامه‌ریزی‌شده شروع', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', labelFa: 'مدیریت الزامات پیش از استخدام', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_PERSONNEL_SCHEDULE', labelFa: 'مدیریت برنامه کار پرسنل', level: 'EDIT', prerequisites: ['PERSONNEL'] },
      { code: 'ARCHIVE_RECRUITMENT_CASE', labelFa: 'بایگانی و بازیابی پرونده', level: 'ADMIN', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_HR_WORK', labelFa: 'مدیریت کارهای منابع انسانی', level: 'EDIT', prerequisites: ['HR_WORK_MANAGEMENT'] },
      { code: 'MANAGE_COMPENSATION', labelFa: 'مدیریت پیشنهاد و جبران خدمت', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_PAYROLL', labelFa: 'ثبت و تأیید اطلاعات حقوق', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'MANAGE_FINANCE_EVIDENCE', labelFa: 'مجوز قدیمی شواهد مالی (غیرفعال در استخدام)', level: 'EDIT', prerequisites: [] },
      { code: 'REVIEW_IDENTITY_DOCUMENTS', labelFa: 'دریافت و تطبیق اسناد هویتی', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES', 'VIEW_FULL_APPLICANT_INFORMATION'] },
      { code: 'APPROVE_IDENTITY_CLEARANCE', labelFa: 'تأیید نهایی احراز هویت', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES', 'VIEW_FULL_APPLICANT_INFORMATION'] },
      { code: 'RESOLVE_CANDIDATE_PERSONNEL_IDENTITY_CONFLICT', labelFa: 'تعیین تکلیف مغایرت هویت متقاضی و پرسنل', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES', 'VIEW_FULL_APPLICANT_INFORMATION'] },
      { code: 'RECORD_SIGNED_EMPLOYMENT_CONTRACT', labelFa: 'ثبت قرارداد کاغذی استخدام', level: 'EDIT', prerequisites: [] },
      { code: 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT', labelFa: 'بررسی قرارداد کاغذی استخدام', level: 'EDIT', prerequisites: [] },
      { code: 'MANAGE_COLLATERAL_REQUIREMENTS', labelFa: 'تعیین الزامات وثیقه متقاضی', level: 'EDIT', prerequisites: ['RECRUITMENT_CASES'] },
      { code: 'RECORD_COLLATERAL_CUSTODY', labelFa: 'ثبت دریافت و نگهداری وثیقه', level: 'EDIT', prerequisites: [] },
      { code: 'VERIFY_COLLATERAL_CUSTODY', labelFa: 'بررسی و تأیید وثیقه', level: 'EDIT', prerequisites: [] },
    ],
  },
  {
    code: 'FOUNDATION_ADMINISTRATION', labelFa: 'مدیریت ساختار سازمانی', permissions: [
      { code: 'PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION', labelFa: 'حذف دائمی واحد، شغل و جایگاه', level: 'ADMIN', prerequisites: ['ORGANIZATIONAL_STRUCTURE'] },
    ],
  },
] as const;

export const HR_ACTION_PERMISSIONS = HR_ACTION_PERMISSION_GROUPS.flatMap((group) => group.permissions);
const definitions = new Map(HR_ACTION_PERMISSIONS.map((permission) => [permission.code, permission]));

export const getHrActionPermissionDefinition = (code: string) => definitions.get(code);

const LEGACY_AUTHORITY_ACTION_BUNDLES: Record<string, string[]> = {
  HR_PROCESSOR: ['RECORD_INITIAL_INTERVIEW', 'RECORD_COMPANY_EVALUATION_RESULT', 'VIEW_FULL_APPLICANT_INFORMATION', 'MANAGE_RECRUITMENT_CASE', 'REVISE_PLANNED_EMPLOYMENT_START', 'MANAGE_PERSONNEL_SCHEDULE', 'REVIEW_IDENTITY_DOCUMENTS'],
  HR_MANAGER: ['VIEW_COMPANY_EVALUATION_RESULTS', 'VIEW_FORMAL_ASSESSMENT_RESULTS', 'RECORD_COMPANY_EVALUATION_RESULT', 'RECORD_PRELIMINARY_DECISION', 'MANAGE_INITIAL_INTERVIEW_CRITERIA', 'MANAGE_RECRUITMENT_EVALUATOR_SETTINGS', 'REVISE_PLANNED_EMPLOYMENT_START', 'ARCHIVE_RECRUITMENT_CASE', 'MANAGE_HR_WORK', 'MANAGE_RECRUITMENT_CASE', 'MANAGE_PERSONNEL_SCHEDULE', 'APPROVE_IDENTITY_CLEARANCE'],
  COMPANY_MANAGER: ['VIEW_COMPANY_EVALUATION_RESULTS', 'VIEW_FORMAL_ASSESSMENT_RESULTS', 'MANAGE_COMPANY_EVALUATION_PLAN', 'RECORD_FINAL_MANAGEMENT_DECISION', 'MANAGE_COMPENSATION', 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS', 'MANAGE_COLLATERAL_REQUIREMENTS', 'MANAGE_PERSONNEL_SCHEDULE'],
  HR_PAYROLL_PROCESSOR: ['MANAGE_PAYROLL'],
  HR_PAYROLL_MANAGER: ['MANAGE_PAYROLL'],
  FINANCE_RECORDER: ['RECORD_COLLATERAL_CUSTODY'],
  FINANCE_MANAGER: ['VERIFY_COLLATERAL_CUSTODY', 'VERIFY_SIGNED_EMPLOYMENT_CONTRACT'],
};

export const expandHrActionPermissionSelection = (selectedCodes: readonly string[]) => {
  const expanded = new Set<string>();
  const include = (code: string) => {
    const definition = definitions.get(code);
    for (const prerequisite of definition?.prerequisites ?? []) include(prerequisite);
    expanded.add(code);
  };
  selectedCodes.forEach(include);
  return [...expanded];
};

export const actionPermissionsForLegacyAuthority = (authorityCode: string) => (
  expandHrActionPermissionSelection(LEGACY_AUTHORITY_ACTION_BUNDLES[authorityCode] ?? [])
);
