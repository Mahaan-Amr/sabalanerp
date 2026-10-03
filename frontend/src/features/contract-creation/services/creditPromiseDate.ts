import PersianCalendar from '@/lib/persian-calendar';

/** Preserve the promised calendar day instead of shifting midnight to the previous UTC day. */
export const creditPromiseDate = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(value)) {
    const date = PersianCalendar.toGregorian(value, 'jYYYY/jMM/jDD');
    if (!Number.isFinite(date.getTime())) return undefined;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
};
