const SECURITY_TIME_ZONE = 'Asia/Tehran';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateParts = (value: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: SECURITY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
) as Record<string, string>;

export const securityDateKeyFromInstant = (value: Date) => {
  const parts = dateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const securityDateKey = (value: Date) => value.toISOString().slice(0, 10);

export const parseSecurityBusinessDate = (value?: unknown, fallback = new Date()) => {
  const raw = String(value || '').trim();
  const key = DATE_ONLY_RE.test(raw)
    ? raw
    : (() => {
        const parsed = raw ? new Date(raw) : fallback;
        return securityDateKeyFromInstant(Number.isNaN(parsed.getTime()) ? fallback : parsed);
      })();
  return new Date(`${key}T00:00:00.000Z`);
};

export const addSecurityDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const securityNowTime = (now = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: SECURITY_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  ) as Record<string, string>;
  return `${parts.hour}:${parts.minute}`;
};

export const securityPersianDate = (date: Date) => date.toLocaleDateString('fa-IR', {
  timeZone: 'UTC'
});

export const securityPersianDateWithWeekday = (date: Date) => date.toLocaleDateString('fa-IR', {
  timeZone: 'UTC',
  weekday: 'long',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
});

export const securityPersianDateTime = (value: unknown) => value
  ? new Date(String(value)).toLocaleString('fa-IR', { timeZone: SECURITY_TIME_ZONE })
  : '-';
