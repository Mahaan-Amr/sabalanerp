const TEHRAN_TIME_ZONE = 'Asia/Tehran';

const civilFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TEHRAN_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TEHRAN_TIME_ZONE,
  timeZoneName: 'longOffset',
});

const parts = (date: Date) => Object.fromEntries(
  civilFormatter.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]),
) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;

const offsetMilliseconds = (date: Date) => {
  const label = offsetFormatter.formatToParts(date).find(({ type }) => type === 'timeZoneName')?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(label ?? '');
  if (!match) throw new Error('TEHRAN_TIME_ZONE_OFFSET_UNAVAILABLE');
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1_000;
};

const civilDateKey = (year: number, month: number, day: number) => (
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

export const addTehranWorkingDays = (
  instant: Date,
  workingDays: number,
  holidays: ReadonlySet<string> = new Set(),
) => {
  if (!Number.isInteger(workingDays) || workingDays < 0) throw new Error('WORKING_DAY_COUNT_INVALID');
  const origin = parts(instant);
  const cursor = new Date(Date.UTC(origin.year, origin.month - 1, origin.day));
  let remaining = workingDays;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const key = civilDateKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());
    if (cursor.getUTCDay() === 5 || holidays.has(key)) continue;
    remaining -= 1;
  }
  const roughUtc = new Date(Date.UTC(
    cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(),
    origin.hour, origin.minute, origin.second, instant.getUTCMilliseconds(),
  ));
  return new Date(roughUtc.getTime() - offsetMilliseconds(roughUtc));
};
