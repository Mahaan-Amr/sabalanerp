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
export const dateFa = (value?: string | null) => value ? new Date(value).toLocaleDateString('fa-IR') : '—';
export const toIsoDate = (value: string) => {
  if (!value) return '';
  const parsed = moment(value, 'jYYYY/jMM/jDD', true);
  return parsed.isValid() ? parsed.startOf('day').toISOString() : value;
};

export const employmentStatusLabel: Record<string, string> = { PLANNED: 'برنامه‌ریزی‌شده', ACTIVE: 'فعال', SUSPENDED: 'تعلیق', ENDED: 'پایان‌یافته' };
export const assignmentTypeLabel: Record<string, string> = { PRIMARY: 'اصلی', SECONDARY: 'ثانویه', ACTING: 'سرپرستی موقت' };
export const unitTypeLabel: Record<string, string> = { COMPANY: 'شرکت', DIVISION: 'حوزه', DEPARTMENT: 'واحد', SECTION: 'بخش', TEAM: 'تیم' };
