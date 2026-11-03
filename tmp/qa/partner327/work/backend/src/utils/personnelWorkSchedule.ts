import { AttendanceWorkScheduleStatus, Prisma } from '@prisma/client';
import { parseSecurityBusinessDate, securityDateKey, securityDateKeyFromInstant, securityNowTime } from './securityBusinessDate';

export interface WorkScheduleDayInput {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface WorkScheduleInput {
  effectiveDate: string;
  days: WorkScheduleDayInput[];
}

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const personnelWorkScheduleInclude = {
  workSchedules: {
    include: { days: { orderBy: { weekday: 'asc' as const } } },
    orderBy: { effectiveFrom: 'desc' as const }
  }
};

export const normalizeWorkSchedule = (value: unknown): WorkScheduleInput | null => {
  if (value === undefined) return null;
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const effectiveDate = String(source.effectiveDate || '').trim();
  if (!effectiveDate) throw new Error('تاریخ اجرای ساعت کاری الزامی است.');
  const parsedEffectiveDate = parseSecurityBusinessDate(effectiveDate);
  if (securityDateKey(parsedEffectiveDate) < securityDateKeyFromInstant(new Date())) {
    throw new Error('تاریخ اجرای ساعت کاری نمی‌تواند در گذشته باشد.');
  }
  const rawDays = Array.isArray(source.days) ? source.days : [];
  const days = rawDays.map((raw) => {
    const day = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const weekday = Number(day.weekday);
    const startTime = String(day.startTime || '').trim();
    const endTime = String(day.endTime || '').trim();
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error('روز کاری معتبر نیست.');
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error('برای هر روز کاری، زمان از و تا باید کامل و معتبر باشد.');
    return { weekday, startTime, endTime };
  });
  if (new Set(days.map((day) => day.weekday)).size !== days.length) throw new Error('هر روز کاری فقط یک‌بار قابل ثبت است.');
  return { effectiveDate: securityDateKey(parsedEffectiveDate), days };
};

export const savePersonnelWorkSchedule = async (
  tx: Prisma.TransactionClient,
  personnelId: string,
  rawSchedule: unknown
) => {
  const schedule = normalizeWorkSchedule(rawSchedule);
  if (!schedule) return null;
  const effectiveFrom = parseSecurityBusinessDate(schedule.effectiveDate);
  return tx.personnelWorkSchedule.upsert({
    where: { personnelId_effectiveFrom: { personnelId, effectiveFrom } },
    create: {
      personnelId,
      effectiveFrom,
      days: { create: schedule.days }
    },
    update: {
      days: {
        deleteMany: {},
        create: schedule.days
      }
    },
    include: { days: { orderBy: { weekday: 'asc' } } }
  });
};

type ScheduleWithDays = {
  id: string;
  personnelId: string;
  effectiveFrom: Date;
  days: Array<{ weekday: number; startTime: string; endTime: string }>;
};

export const loadApplicableWorkSchedules = async (
  client: { personnelWorkSchedule: { findMany: Function } },
  personnelIds: string[],
  targetDate: Date
) => {
  if (!personnelIds.length) return new Map<string, ScheduleWithDays>();
  const schedules = await client.personnelWorkSchedule.findMany({
    where: { personnelId: { in: personnelIds }, effectiveFrom: { lte: targetDate } },
    include: { days: { orderBy: { weekday: 'asc' } } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }]
  }) as ScheduleWithDays[];
  const byPersonnel = new Map<string, ScheduleWithDays>();
  schedules.forEach((schedule) => {
    if (!byPersonnel.has(schedule.personnelId)) byPersonnel.set(schedule.personnelId, schedule);
  });
  return byPersonnel;
};

export const persianWeekdayIndex = (targetDate: Date) => (targetDate.getUTCDay() + 1) % 7;

export const resolveWorkScheduleDay = (schedule: ScheduleWithDays | undefined, targetDate: Date) => {
  if (!schedule || schedule.days.length === 0) return {
    status: AttendanceWorkScheduleStatus.UNCONFIGURED,
    day: null
  };
  const day = schedule.days.find((item) => item.weekday === persianWeekdayIndex(targetDate)) || null;
  return {
    status: day ? AttendanceWorkScheduleStatus.WORKDAY : AttendanceWorkScheduleStatus.NON_WORKING_DAY,
    day
  };
};

export const timeMinutes = (time?: string | null) => {
  if (!time || !TIME_RE.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const calculateDelayMinutes = (entryTime: string, scheduledStart: string) => {
  const entry = timeMinutes(entryTime);
  const start = timeMinutes(scheduledStart);
  if (entry === null || start === null) return 0;
  return Math.max(0, entry - start);
};

export const calculateScheduledOvertime = (exitTime: string, scheduledStart: string, scheduledEnd: string) => {
  const exit = timeMinutes(exitTime);
  const start = timeMinutes(scheduledStart);
  const end = timeMinutes(scheduledEnd);
  if (exit === null || start === null || end === null) return null;
  const normalizedEnd = end <= start ? end + 1440 : end;
  const normalizedExit = exit < start ? exit + 1440 : exit;
  return Math.max(0, normalizedExit - normalizedEnd);
};

export const calculatePresenceMinutes = (entryTime: string, exitTime: string) => {
  const entry = timeMinutes(entryTime);
  const exit = timeMinutes(exitTime);
  if (entry === null || exit === null) return null;
  const normalizedExit = exit < entry ? exit + 1440 : exit;
  return Math.max(0, normalizedExit - entry);
};

export const scheduledStartHasPassed = (targetDate: Date, startTime: string, now = new Date()) => {
  const targetKey = securityDateKey(targetDate);
  const todayKey = securityDateKeyFromInstant(now);
  if (targetKey < todayKey) return true;
  if (targetKey > todayKey) return false;
  const start = timeMinutes(startTime) || 0;
  const current = timeMinutes(securityNowTime(now)) || 0;
  return current >= start;
};
