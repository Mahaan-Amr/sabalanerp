import { AttendanceIntervalStatus } from '@prisma/client';

export type PersonnelAttendanceReportOptions = {
  startDate: Date;
  endDate: Date;
  restMinutes: number;
  personnelIds: string[];
  includeNoMovement: boolean;
  mergeMatchingNames: boolean;
};

export type PersonnelAttendanceSourceRow = {
  id: string;
  date: Date;
  personnelId: string | null;
  employeeId: string | null;
  securityPersonnelId: string | null;
  personnelFirstName: string | null;
  personnelLastName: string | null;
  personnel?: { firstName: string; lastName: string } | null;
  employee?: { firstName: string; lastName: string; personnelId: string | null } | null;
  intervals: Array<{ enteredAt: Date; exitedAt: Date | null; status: AttendanceIntervalStatus | string }>;
};

export type PersonnelAttendanceDay = {
  date: string;
  intervals: Array<{ enteredAt: string; exitedAt: string | null }>;
  grossMinutes: number;
  netMinutes: number;
};

export type PersonnelAttendancePerson = {
  key: string;
  name: string;
  personnelIds: string[];
  days: PersonnelAttendanceDay[];
  grossMinutes: number;
  netMinutes: number;
  daysWithMovement: number;
  intervalCount: number;
};

export class PersonnelAttendanceReportInputError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const dateOnly = (value: unknown) => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || dayKey(date) !== value ? null : date;
};

export function parsePersonnelAttendanceReportOptions(input: unknown): PersonnelAttendanceReportOptions {
  const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const startDate = dateOnly(body.startDate);
  const endDate = dateOnly(body.endDate);
  if (!startDate || !endDate || endDate < startDate || (endDate.getTime() - startDate.getTime()) / 86_400_000 > 92) {
    throw new PersonnelAttendanceReportInputError('بازه گزارش باید معتبر و حداکثر ۹۳ روز باشد.');
  }
  const restMinutes = body.restMinutes === undefined ? 120 : body.restMinutes;
  if (!Number.isInteger(restMinutes) || (restMinutes as number) < 0 || (restMinutes as number) > 240) {
    throw new PersonnelAttendanceReportInputError('زمان استراحت باید بین ۰ تا ۲۴۰ دقیقه باشد.');
  }
  if (body.personnelIds !== undefined && (!Array.isArray(body.personnelIds) || body.personnelIds.length > 100 || body.personnelIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 100))) {
    throw new PersonnelAttendanceReportInputError('انتخاب پرسنل معتبر نیست.');
  }
  for (const name of ['includeNoMovement', 'mergeMatchingNames']) {
    if (body[name] !== undefined && typeof body[name] !== 'boolean') throw new PersonnelAttendanceReportInputError('تنظیمات گزارش معتبر نیست.');
  }
  return {
    startDate, endDate,
    restMinutes: restMinutes as number,
    personnelIds: [...new Set((body.personnelIds as string[] | undefined) || [])],
    includeNoMovement: body.includeNoMovement !== false,
    mergeMatchingNames: body.mergeMatchingNames !== false,
  };
}

function identity(row: PersonnelAttendanceSourceRow) {
  const id = row.personnelId || row.employee?.personnelId || row.employeeId || row.securityPersonnelId || row.id;
  const firstName = row.personnelFirstName || row.personnel?.firstName || row.employee?.firstName || '';
  const lastName = row.personnelLastName || row.personnel?.lastName || row.employee?.lastName || '';
  const name = `${firstName} ${lastName}`.trim() || 'پرسنل بدون نام';
  return { id, name };
}

export function buildPersonnelAttendanceReport(rows: PersonnelAttendanceSourceRow[], options: PersonnelAttendanceReportOptions) {
  const available = new Map<string, string>();
  for (const row of rows) {
    const person = identity(row);
    available.set(person.id, person.name);
  }
  const people = [...available].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  const requested = new Set(options.personnelIds);
  if ([...requested].some((id) => !available.has(id))) throw new PersonnelAttendanceReportInputError('یک یا چند نفر در بازه انتخاب‌شده رکورد ندارند.');

  const groups = new Map<string, { name: string; ids: Set<string>; days: Map<string, PersonnelAttendanceDay> }>();
  let voidedIntervals = 0;
  let openIntervals = 0;
  for (const row of rows) {
    const person = identity(row);
    if (requested.size && !requested.has(person.id)) continue;
    const valid = row.intervals.filter((interval) => {
      if (interval.status === AttendanceIntervalStatus.VOIDED) { voidedIntervals++; return false; }
      return true;
    });
    if (!options.includeNoMovement && !valid.length) continue;
    const key = options.mergeMatchingNames ? person.name : person.id;
    if (!groups.has(key)) groups.set(key, { name: person.name, ids: new Set(), days: new Map() });
    const group = groups.get(key)!;
    group.ids.add(person.id);
    const date = dayKey(row.date);
    if (!group.days.has(date)) group.days.set(date, { date, intervals: [], grossMinutes: 0, netMinutes: 0 });
    const day = group.days.get(date)!;
    for (const interval of valid) {
      day.intervals.push({ enteredAt: interval.enteredAt.toISOString(), exitedAt: interval.exitedAt?.toISOString() || null });
      if (!interval.exitedAt) { openIntervals++; continue; }
      const minutes = Math.floor((interval.exitedAt.getTime() - interval.enteredAt.getTime()) / 60_000);
      if (minutes < 0) throw new Error('بازه تردد با زمان خروج پیش از ورود یافت شد.');
      day.grossMinutes += minutes;
    }
  }
  const reportPeople: PersonnelAttendancePerson[] = [...groups].map(([key, group]) => {
    const days = [...group.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of days) {
      day.intervals.sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
      day.netMinutes = Math.max(0, day.grossMinutes - options.restMinutes);
    }
    return {
      key, name: group.name, personnelIds: [...group.ids], days,
      grossMinutes: days.reduce((sum, day) => sum + day.grossMinutes, 0),
      netMinutes: days.reduce((sum, day) => sum + day.netMinutes, 0),
      daysWithMovement: days.filter((day) => day.intervals.length > 0).length,
      intervalCount: days.reduce((sum, day) => sum + day.intervals.length, 0),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  return {
    startDate: dayKey(options.startDate), endDate: dayKey(options.endDate),
    restMinutes: options.restMinutes, includeNoMovement: options.includeNoMovement,
    mergeMatchingNames: options.mergeMatchingNames, availablePeople: people,
    people: reportPeople, records: reportPeople.reduce((sum, person) => sum + person.days.length, 0),
    validIntervals: reportPeople.reduce((sum, person) => sum + person.intervalCount, 0),
    voidedIntervals, openIntervals,
  };
}
