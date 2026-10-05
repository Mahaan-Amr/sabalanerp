const blockerLabels: Record<string, string> = {
  PERSONNEL_INACTIVE: 'پرونده پرسنلی فعال نیست',
  EMPLOYMENT_INACTIVE: 'رابطه استخدامی فعال نیست',
  ELIGIBILITY_INACTIVE: 'مجوز رانندگی فعال نیست',
  DRIVING_PROFILE_INACTIVE: 'مشخصات رانندگی فعال نیست',
  LICENCE_NUMBER_MISSING: 'شماره گواهینامه ثبت نشده',
  LICENCE_CLASS_MISSING: 'نوع گواهینامه ثبت نشده',
  LICENCE_EXPIRY_MISSING: 'تاریخ انقضای گواهینامه ثبت نشده',
  LICENCE_EXPIRED: 'گواهینامه منقضی شده',
  VEHICLE_NOT_ASSIGNED: 'خودرویی تخصیص داده نشده',
  VEHICLE_NOT_ACTIVE: 'خودروی تخصیص‌یافته فعال نیست',
  VEHICLE_PLATE_MISSING: 'پلاک معتبر ثبت نشده',
  LIFECYCLE_INACTIVE: 'پرونده فعال نیست',
  DRIVING_LICENCE_MISSING: 'مدرک گواهینامه ثبت نشده',
  DRIVING_LICENCE_EXPIRED: 'مدرک گواهینامه منقضی شده',
  VEHICLE_REGISTRATION_MISSING: 'مدرک خودرو ثبت نشده',
  VEHICLE_REGISTRATION_EXPIRED: 'مدرک خودرو منقضی شده',
  CONTINUITY_LINKED_INTERNAL_IDENTITY_ACTIVE: 'هویت داخلی مرتبط هنوز فعال است',
  LEGACY_SOURCE_ONLY: 'این سابقه فقط برای مشاهده تاریخی است',
};

export const readinessBlockerLabel = (blocker: string) =>
  blockerLabels[blocker] || (/[A-Za-z]/.test(blocker) ? 'پیش‌نیاز ورود به صف کامل نیست' : blocker);
