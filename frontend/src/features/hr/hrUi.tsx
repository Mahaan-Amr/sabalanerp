import moment from 'moment-jalaali';

export const apiError = (error: any) => error?.response?.data?.error || error?.message || 'انجام عملیات ناموفق بود.';
const latinDigits = (value: string) => value
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

export const dateFa = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran' }).format(new Date(value))
  : '—';
export const dateTimeFa = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }).format(new Date(value))
  : '—';
export const toIsoDate = (value: string) => {
  if (!value) return '';
  const parsed = moment(latinDigits(value), 'jYYYY/jMM/jDD', true);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : value;
};
export const fromIsoDate = (value?: string | null) => {
  if (!value) return '';
  const parsed = moment(String(value).slice(0, 10), 'YYYY-MM-DD', true);
  return parsed.isValid() ? parsed.format('jYYYY/jMM/jDD') : String(value);
};
export const fromIsoDateTime = (value?: string | null) => {
  if (!value) return '';
  const parsed = moment(value);
  return parsed.isValid()
    ? parsed.utcOffset(3 * 60 + 30).format('jYYYY/jMM/jDD HH:mm')
    : String(value);
};
export const toIsoDateTime = (value: string) => {
  if (!value) return '';
  const parsed = moment(latinDigits(value), 'jYYYY/jMM/jDD HH:mm', true);
  if (!parsed.isValid()) return value;
  const [datePart, timePart] = parsed.format('YYYY-MM-DD HH:mm').split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const tehranOffsetMinutes = 3 * 60 + 30;
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) -
      tehranOffsetMinutes * 60_000,
  ).toISOString();
};

export const employmentStatusLabel: Record<string, string> = { PLANNED: 'برنامه‌ریزی‌شده', ACTIVE: 'فعال', SUSPENDED: 'تعلیق', ENDED: 'پایان‌یافته' };
export const assignmentTypeLabel: Record<string, string> = { PRIMARY: 'اصلی', SECONDARY: 'ثانویه', ACTING: 'سرپرستی موقت' };
export const unitTypeLabel: Record<string, string> = { COMPANY: 'شرکت', DIVISION: 'حوزه', DEPARTMENT: 'واحد', SECTION: 'بخش', TEAM: 'تیم' };
