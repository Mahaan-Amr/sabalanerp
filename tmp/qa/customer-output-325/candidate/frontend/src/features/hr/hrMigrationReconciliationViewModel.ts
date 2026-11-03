const primaryStateLabels: Record<string, string> = {
  PERSONNEL_CURRENT: 'پرسنل جاری',
  PERSONNEL_INACTIVE_ENDED: 'پرسنل غیرفعال با رابطه پایان‌یافته',
  USER_PERSONNEL_LINKED: 'کاربر متصل به پرسنل',
  USER_ACCESS_ONLY: 'کاربر فقط برای دسترسی',
  USER_LINKAGE_UNRESOLVED: 'اتصال کاربر و پرسنل حل‌نشده',
  EMPLOYMENT_CURRENT: 'رابطه استخدامی جاری',
  EMPLOYMENT_ENDED: 'رابطه استخدامی پایان‌یافته',
  LEGACY_ONLY_HISTORY: 'فقط سابقه قدیمی',
  NEUTRAL_HISTORY: 'سابقه خنثی',
  CLASSIFICATION_ERROR: 'خطای طبقه‌بندی',
};

const attentionFlagLabels: Record<string, string> = {
  UNRESOLVED_PERSONNEL_LINKAGE: 'اتصال پرسنلی حل‌نشده',
  POSSIBLE_DUPLICATE_IDENTITY: 'احتمال هویت تکراری',
  INCOMPLETE_ORGANIZATIONAL_MAPPING: 'نگاشت سازمانی ناقص',
  MISSING_PRIMARY_ASSIGNMENT: 'تخصیص اصلی ثبت نشده',
  EMPLOYMENT_STATE_INCONSISTENCY: 'ناسازگاری وضعیت استخدام',
  OPEN_START_DATE_REVIEW: 'بررسی تاریخ شروع باز است',
  ASSESSMENT_PLAN_RECONCILIATION: 'تطبیق برنامه ارزیابی حل‌نشده',
  CLASSIFICATION_ERROR: 'خطای طبقه‌بندی',
};

export const migrationPrimaryStateLabel = (code: string) => primaryStateLabels[code] ?? 'خطای طبقه‌بندی';
export const migrationAttentionFlagLabel = (code: string) => attentionFlagLabels[code] ?? 'خطای طبقه‌بندی';

export const migrationSourceTypeLabel = (code: string) => ({
  PERSONNEL: 'پرسنل',
  USER: 'کاربر',
  EMPLOYMENT_RELATIONSHIP: 'رابطه استخدامی',
  APPLICATION: 'پرونده استخدام',
  LEGACY_HISTORY: 'سابقه قدیمی',
}[code] ?? 'منبع طبقه‌بندی‌نشده');

export const safeMigrationReturnPath = (value?: string | null) => {
  if (!value) return '/dashboard/hr/migration';
  try {
    const decoded = decodeURIComponent(value);
    return decoded === '/dashboard/hr/migration' || decoded.startsWith('/dashboard/hr/migration?')
      ? decoded
      : '/dashboard/hr/migration';
  } catch {
    return '/dashboard/hr/migration';
  }
};

export const reconciliationFilterHref = (
  filter: { primaryState?: string; attentionFlag?: string; cutoverBlocker?: boolean; sourceType?: string },
  returnPath = '/dashboard/hr/migration',
) => {
  const search = new URLSearchParams();
  if (filter.primaryState) search.set('primaryState', filter.primaryState);
  if (filter.attentionFlag) search.set('attentionFlag', filter.attentionFlag);
  if (filter.cutoverBlocker !== undefined) search.set('cutoverBlocker', String(filter.cutoverBlocker));
  if (filter.sourceType) search.set('sourceType', filter.sourceType);
  search.set('return', safeMigrationReturnPath(returnPath));
  return `/dashboard/hr/migration/reconciliation?${search.toString()}`;
};

type ReviewOption = { value: string; label: string };

const reviewOptionsByFlag: Record<string, ReviewOption[]> = {
  UNRESOLVED_PERSONNEL_LINKAGE: [{ value: 'ACCESS_ONLY_USER', label: 'کاربر فقط برای دسترسی است' }],
  POSSIBLE_DUPLICATE_IDENTITY: [
    { value: 'DIFFERENT_PEOPLE', label: 'افراد متفاوت‌اند' },
    { value: 'SHARED_IDENTITY', label: 'هویت مشترک ثبت شده است' },
    { value: 'STILL_AMBIGUOUS', label: 'ابهام همچنان باقی است' },
  ],
  INCOMPLETE_ORGANIZATIONAL_MAPPING: [
    { value: 'ORGANIZATION_MAPPED', label: 'به سازمان موجود نگاشت شد' },
    { value: 'ORGANIZATION_CREATED', label: 'سازمان جدید ثبت شد' },
    { value: 'ORGANIZATION_HISTORICAL', label: 'سازمان فقط تاریخی است' },
  ],
  OPEN_START_DATE_REVIEW: [{ value: 'START_DATE_UNRECOVERABLE', label: 'تاریخ واقعی قابل بازیابی نیست' }],
};

const legacyOnlyOption: ReviewOption = { value: 'LEGACY_ONLY_CONFIRMED', label: 'فقط سابقه قدیمی تأیید شد' };

export const allowedReviewOutcomes = (flags: readonly string[], primaryState?: string) => {
  const seen = new Set<string>();
  const options = [
    ...flags.flatMap((flag) => reviewOptionsByFlag[flag] ?? []),
    ...(flags.length === 0 && primaryState === 'NEUTRAL_HISTORY' ? [legacyOnlyOption] : []),
  ];
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
};
