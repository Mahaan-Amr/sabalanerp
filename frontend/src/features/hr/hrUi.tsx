import type { ReactNode } from 'react';
import moment from 'moment-jalaali';

export const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0b6662] focus:ring-2 focus:ring-[#0b6662]/15 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export function HrField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
    <span>{label}{required && <span className="mr-1 text-red-500">*</span>}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{hint}</span>}
  </label>;
}

export function HrMessage({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'warning'; children: ReactNode }) {
  const classes = tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' : tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200';
  return <div className={`rounded-xl border px-4 py-3 text-sm ${classes}`}>{children}</div>;
}

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
