import { AttendanceIntervalStatus } from '@prisma/client';
import type { AccountingProjection } from './personnelAttendanceAccounting';

export type PersonnelAttendanceReportOptions = {
  startDate: Date;
  endDate: Date;
  restMinutes: number;
  legacyRestKnown?: boolean;
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
  intervals: Array<{ enteredAt: Date | null; exitedAt: Date | null; status: AttendanceIntervalStatus | string; exitUnknown?: boolean; revision?: number; confirmedRevision?: number }>;
  accounting?: AccountingProjection;
};

export type PersonnelAttendanceDay = {
  date: string;
  intervals: Array<{ enteredAt: string | null; exitedAt: string | null; exitUnknown?: boolean }>;
  physicalDurationUnknown?: boolean;
  durationUnknown?: boolean;
  provisional?: boolean;
  grossMinutes: number;
  netMinutes: number;
  accounting?: AccountingProjection;
  method?: 'WINDOW' | 'LEGACY';
  legacyRestKnown?: boolean;
};

export type PersonnelAttendancePerson = {
  key: string;
  name: string;
  personnelIds: string[];
  days: PersonnelAttendanceDay[];
  physicalDurationUnknown?: boolean;
  durationUnknown?: boolean;
  provisional?: boolean;
  grossMinutes: number;
  netMinutes: number;
  netCalculationUnknown?: boolean;
  daysWithMovement: number;
  intervalCount: number;
  shortageMinutes?: number | null;
  missionMinutes?: number | null;
  leaveMinutes?: number | null;
  outsideScheduleMinutes?: number | null;
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
    legacyRestKnown: body.restMinutes !== undefined,
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

export function buildPersonnelAttendanceReport(rows: PersonnelAttendanceSourceRow[], options: PersonnelAttendanceReportOptions, catalog: Array<{ id: string; name: string }> = []) {
  const available = new Map(catalog.map(person => [person.id, person.name]));
  for (const row of rows) {
    const person = identity(row);
    available.set(person.id, person.name);
  }
  const people = [...available].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  const requested = new Set(options.personnelIds);
  if ([...requested].some((id) => !available.has(id))) throw new PersonnelAttendanceReportInputError('یک یا چند نفر در بازه انتخاب‌شده رکورد ندارند.');

  const groups = new Map<string, { name: string; ids: Set<string>; days: Map<string, PersonnelAttendanceDay> }>();
  const selectedRows = rows.filter(row => !requested.size || requested.has(identity(row).id));
  const includedRows = selectedRows.filter(row => options.includeNoMovement || row.intervals.some(i => i.status !== AttendanceIntervalStatus.VOIDED) || row.accounting?.applicableAuthorization);
  const hasWindowPolicy = includedRows.some(row => row.accounting);
  const voidedIntervals = selectedRows.reduce((sum, row) => sum + row.intervals.filter(i => i.status === AttendanceIntervalStatus.VOIDED).length, 0);
  let openIntervals = 0;
  for (const row of includedRows) {
    const person = identity(row);
    const valid = row.intervals.filter((interval) => {
      if (interval.status === AttendanceIntervalStatus.VOIDED) return false;
      return true;
    });
    if (!options.includeNoMovement && !valid.length && !row.accounting?.applicableAuthorization) continue;
    const key = options.mergeMatchingNames && !hasWindowPolicy ? person.name : person.id;
    if (!groups.has(key)) groups.set(key, { name: person.name, ids: new Set(), days: new Map() });
    const group = groups.get(key)!;
    group.ids.add(person.id);
    const date = dayKey(row.date);
    if (!group.days.has(date)) group.days.set(date, { date, intervals: [], grossMinutes: 0, netMinutes: 0 });
    const day = group.days.get(date)!;
    if (row.accounting) {
      day.accounting = row.accounting;
      day.method = 'WINDOW';
      day.grossMinutes = row.accounting.physicalMinutes;
      day.netMinutes = row.accounting.workMinutes ?? 0;
      day.durationUnknown = row.accounting.issues.some(i => i !== 'OPEN_DAY');
      day.physicalDurationUnknown = row.accounting.issues.some(i => ['UNKNOWN_TIME', 'OVERLAPPING_ATTENDANCE'].includes(i));
      day.provisional = !row.accounting.final;
      day.intervals.push(...valid.map(interval => ({ enteredAt: interval.enteredAt?.toISOString() || null, exitedAt: interval.exitedAt?.toISOString() || null, exitUnknown: interval.exitUnknown })));
      openIntervals += valid.filter(i => !i.enteredAt || !i.exitedAt || i.exitUnknown).length;
      continue;
    }
    day.method = 'LEGACY';
    day.legacyRestKnown = options.legacyRestKnown !== false;
    for (const interval of valid) {
      if (!interval.enteredAt || !interval.exitedAt || interval.exitUnknown) { day.durationUnknown = true; day.physicalDurationUnknown = true; }
      if (interval.revision !== undefined && interval.revision !== interval.confirmedRevision) day.provisional = true;
      day.intervals.push({ enteredAt: interval.enteredAt?.toISOString() || null, exitedAt: interval.exitedAt?.toISOString() || null, exitUnknown: interval.exitUnknown });
      if (!interval.enteredAt || !interval.exitedAt || interval.exitUnknown) { openIntervals++; continue; }
      const minutes = Math.floor((interval.exitedAt.getTime() - interval.enteredAt.getTime()) / 60_000);
      if (minutes < 0) throw new Error('بازه تردد با زمان خروج پیش از ورود یافت شد.');
      day.grossMinutes += minutes;
    }
  }
  const reportPeople: PersonnelAttendancePerson[] = [...groups].map(([key, group]) => {
    const days = [...group.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of days) {
      day.intervals.sort((a, b) => a.enteredAt && b.enteredAt ? a.enteredAt.localeCompare(b.enteredAt) : a.enteredAt ? -1 : b.enteredAt ? 1 : 0);
      if (!day.accounting) {
        day.netMinutes = day.legacyRestKnown ? Math.max(0, day.grossMinutes - options.restMinutes) : 0;
        if (!day.legacyRestKnown) { day.durationUnknown = true; day.provisional = true; }
      }
    }
    return {
      key, name: group.name, personnelIds: [...group.ids], days,
      physicalDurationUnknown: days.some(d => d.physicalDurationUnknown),
      durationUnknown: days.some(d => d.durationUnknown), provisional: days.some(d => d.provisional),
      grossMinutes: days.reduce((sum, day) => sum + day.grossMinutes, 0),
      netMinutes: days.reduce((sum, day) => sum + day.netMinutes, 0),
      netCalculationUnknown: days.every(d => d.accounting ? d.accounting.workMinutes == null : d.legacyRestKnown === false),
      daysWithMovement: days.filter((day) => day.intervals.length > 0).length,
      intervalCount: days.reduce((sum, day) => sum + day.intervals.length, 0),
      shortageMinutes: days.every(d => d.accounting?.shortageMinutes != null) ? days.reduce((sum, d) => sum + d.accounting!.shortageMinutes!, 0) : null,
      missionMinutes: days.every(d => d.accounting?.missionMinutes != null) ? days.reduce((sum, d) => sum + d.accounting!.missionMinutes!, 0) : null,
      leaveMinutes: days.every(d => d.accounting?.leaveMinutes != null) ? days.reduce((sum, d) => sum + d.accounting!.leaveMinutes!, 0) : null,
      outsideScheduleMinutes: days.every(d => d.accounting?.outsideScheduleMinutes != null) ? days.reduce((sum, d) => sum + d.accounting!.outsideScheduleMinutes!, 0) : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  return {
    startDate: dayKey(options.startDate), endDate: dayKey(options.endDate),
    restMinutes: options.restMinutes, includeNoMovement: options.includeNoMovement,
    mergeMatchingNames: options.mergeMatchingNames && !hasWindowPolicy, hasWindowPolicy, hasLegacyPolicy: includedRows.some(row => !row.accounting), availablePeople: people,
    people: reportPeople, records: reportPeople.reduce((sum, person) => sum + person.days.length, 0),
    validIntervals: reportPeople.reduce((sum, person) => sum + person.intervalCount, 0),
    voidedIntervals, openIntervals,
  };
}
