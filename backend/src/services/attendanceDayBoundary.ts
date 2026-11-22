import { securityDateKeyFromInstant } from '../utils/securityBusinessDate';
/** A system-carried unknown exit remains reviewable without preventing a guard handover. */
export const DAY_ROLLOVER_SOURCE = 'DAY_ROLLOVER';
export const DAY_ROLLOVER_REASON = 'ثبت سیستمی شروع روز جدید؛ ساعت خروج روز قبل نامعلوم است و نیاز به اصلاح دارد.';
export const isDeferredDayExit = (interval: { exitUnknown?: boolean; exitSource?: string | null }) =>
  interval.exitUnknown === true && interval.exitSource === DAY_ROLLOVER_SOURCE;
export function onlyDeferredUnknownTimes(intervals: Array<{ enteredAt: unknown; exitedAt: unknown; exitUnknown?: boolean; exitSource?: string | null }>, today?: string) {
  const unknown = intervals.filter(i => !i.enteredAt || !i.exitedAt || i.exitUnknown);
  return unknown.length > 0 && unknown.every(interval => {
    if (!interval.enteredAt) return false;
    if (isDeferredDayExit(interval)) return true;
    if (!today || interval.exitUnknown || interval.exitedAt) return false;
    const entered = interval.enteredAt instanceof Date ? interval.enteredAt : new Date(String(interval.enteredAt));
    return securityDateKeyFromInstant(entered) < today;
  });
}
