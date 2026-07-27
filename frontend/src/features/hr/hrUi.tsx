import type { ReactNode } from 'react';
import moment from 'moment-jalaali';

export const fieldClass = 'w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2.5 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]';

export function HrField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
    <span>{label}{required && <span className="mr-1 text-[var(--sds-danger)]">*</span>}</span>
    {children}
    {hint && <span className="block text-xs font-normal text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{hint}</span>}
  </label>;
}

export function HrMessage({ tone = 'danger', children }: { tone?: 'danger' | 'success' | 'warning'; children: ReactNode }) {
  const classes = tone === 'success' ? 'border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]' : tone === 'warning' ? 'border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]' : 'border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]';
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
