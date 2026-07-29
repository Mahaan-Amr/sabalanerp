import type { Prisma, PrismaClient } from '@prisma/client';
import type { TicketPriority } from './supportTicketPolicy';

type Database = PrismaClient | Prisma.TransactionClient;
export type SupportCalendar = {
  timezone: string;
  schedule: Record<string, [number, number] | null>;
  holidays: string[];
};
export type SupportTargets = Record<TicketPriority, { acknowledgmentMinutes: number; resolutionMinutes: number }>;

export const defaultSupportCalendar: SupportCalendar = {
  timezone: 'Asia/Tehran',
  schedule: {
    SATURDAY: [8 * 60, 17 * 60],
    SUNDAY: [8 * 60, 17 * 60],
    MONDAY: [8 * 60, 17 * 60],
    TUESDAY: [8 * 60, 17 * 60],
    WEDNESDAY: [8 * 60, 17 * 60],
    THURSDAY: [8 * 60, 13 * 60],
    FRIDAY: null,
  },
  holidays: [],
};

export const defaultSupportTargets: SupportTargets = {
  LOW: { acknowledgmentMinutes: 480, resolutionMinutes: 2_400 },
  NORMAL: { acknowledgmentMinutes: 240, resolutionMinutes: 1_440 },
  HIGH: { acknowledgmentMinutes: 60, resolutionMinutes: 480 },
  URGENT: { acknowledgmentMinutes: 15, resolutionMinutes: 120 },
};

const dateParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return {
    weekday: value('weekday').toUpperCase(),
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
  };
};

export const isSupportMinute = (date: Date, calendar: SupportCalendar) => {
  const local = dateParts(date, calendar.timezone);
  if (calendar.holidays.includes(local.dateKey)) return false;
  const interval = calendar.schedule[local.weekday];
  return Boolean(interval && local.minuteOfDay >= interval[0] && local.minuteOfDay < interval[1]);
};

export const addSupportMinutes = (start: Date, minutes: number, calendar: SupportCalendar) => {
  let cursor = new Date(start);
  let remaining = Math.max(0, Math.ceil(minutes));
  let guard = 0;
  while (remaining > 0 && guard < 600_000) {
    cursor = new Date(cursor.getTime() + 60_000);
    if (isSupportMinute(cursor, calendar)) remaining -= 1;
    guard += 1;
  }
  if (remaining > 0) throw new Error('Support calendar could not resolve the requested deadline.');
  return cursor;
};

export const elapsedSupportMinutes = (start: Date, end: Date, calendar: SupportCalendar) => {
  let cursor = new Date(start);
  let elapsed = 0;
  let guard = 0;
  while (cursor < end && guard < 600_000) {
    cursor = new Date(Math.min(end.getTime(), cursor.getTime() + 60_000));
    if (isSupportMinute(cursor, calendar)) elapsed += 1;
    guard += 1;
  }
  return elapsed;
};

export const parseSupportCalendar = (value: Prisma.JsonValue): SupportCalendar => {
  const parsed = value as unknown as SupportCalendar;
  if (!parsed?.timezone || !parsed.schedule || !Array.isArray(parsed.holidays)) throw new Error('Support calendar is invalid.');
  return parsed;
};

export const parseSupportTargets = (value: Prisma.JsonValue): SupportTargets => {
  const parsed = value as unknown as SupportTargets;
  for (const priority of ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as TicketPriority[]) {
    if (!Number.isFinite(parsed?.[priority]?.acknowledgmentMinutes) || !Number.isFinite(parsed?.[priority]?.resolutionMinutes)) {
      throw new Error('Support targets are invalid.');
    }
  }
  return parsed;
};

export const latestSupportSlaPolicy = async (database: Database) => {
  const existing = await database.supportSlaPolicyVersion.findFirst({ orderBy: { version: 'desc' } });
  if (existing) return existing;
  return database.supportSlaPolicyVersion.create({
    data: {
      version: 1,
      calendar: defaultSupportCalendar as unknown as Prisma.InputJsonValue,
      targets: defaultSupportTargets as unknown as Prisma.InputJsonValue,
      changeReason: 'سیاست پیش‌فرض ثبت‌شده در کد',
    },
  });
};

export const supportDeadlines = ({
  triagedAt,
  priority,
  calendar,
  targets,
}: {
  triagedAt: Date;
  priority: TicketPriority;
  calendar: SupportCalendar;
  targets: SupportTargets;
}) => ({
  acknowledgmentDueAt: addSupportMinutes(triagedAt, targets[priority].acknowledgmentMinutes, calendar),
  resolutionDueAt: addSupportMinutes(triagedAt, targets[priority].resolutionMinutes, calendar),
});
