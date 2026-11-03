const DAY = 86_400_000;
const TEHRAN_TIME_ZONE = 'Asia/Tehran';

const persianParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: TEHRAN_TIME_ZONE
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read('year'), month: read('month'), day: read('day') };
};

const gregorianParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    hourCycle: 'h23', timeZone: TEHRAN_TIME_ZONE
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
};

const tehranMidnightUtc = (year: number, month: number, day: number) => {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = gregorianParts(new Date(guess));
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += target - represented;
  }
  return new Date(guess);
};

export const startOfPersianMonth = (date: Date) => {
  let cursor = new Date(date);
  while (persianParts(cursor).day !== 1) cursor = new Date(cursor.getTime() - DAY);
  const firstDay = gregorianParts(cursor);
  return tehranMidnightUtc(firstDay.year, firstDay.month, firstDay.day);
};

export type HrWorkProgressItem = {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'WAIVED';
  completedAt?: Date | null;
};

export const personalHrWorkProgress = (items: HrWorkProgressItem[], now = new Date()) => {
  const monthStart = startOfPersianMonth(now);
  const completed = items.filter((item) => item.status === 'COMPLETE' && item.completedAt && item.completedAt >= monthStart).length;
  const remaining = items.filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS').length;
  const total = completed + remaining;
  return {
    completed,
    remaining,
    total,
    percentage: total === 0 ? null : Math.round((completed / total) * 100)
  };
};

export const eligibleUsersForHiringAction = (
  actionAuthorities: string[],
  authoritiesByUser: Map<string, Set<string>>
) => [...authoritiesByUser.entries()]
  .filter(([, authorities]) => actionAuthorities.some((authority) => authorities.has(authority)))
  .map(([userId]) => userId)
  .sort();

export const automaticHiringWorkItemBaseKey = (applicationId: string, actionId: string) =>
  `HIRING:${applicationId}:${actionId}`;

export const automaticHiringWorkItemSourceKey = (
  applicationId: string,
  actionId: string,
  userId: string | null
) => `${automaticHiringWorkItemBaseKey(applicationId, actionId)}:${userId ? `USER:${userId}` : 'UNASSIGNED'}`;

export const automaticHiringWorkItemBaseKeyFromSource = (sourceKey: string) =>
  sourceKey.replace(/:(?:USER:[^:]+|UNASSIGNED)$/, '');

export const staleAutomaticHiringWorkItemStatus = (
  sourceKey: string,
  activeActionBaseKeys: Set<string>
): 'COMPLETE' | 'WAIVED' => activeActionBaseKeys.has(automaticHiringWorkItemBaseKeyFromSource(sourceKey))
  ? 'WAIVED'
  : 'COMPLETE';
