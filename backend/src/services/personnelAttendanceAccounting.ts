import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { accountAttendanceDay, AttendanceAuthority } from './attendanceRestAccounting';
import { buildPersonnelAttendanceReport, PersonnelAttendanceReportOptions, PersonnelAttendanceSourceRow } from './personnelAttendanceReport';
import { persianWeekdayIndex } from '../utils/personnelWorkSchedule';
import { securityDateKey } from '../utils/securityBusinessDate';

const dayAfter = (date: Date, offset = 1) => new Date(date.getTime() + offset * 86400000);
const latest = <T extends { effectiveFrom: Date }>(rows: T[], date: Date) => rows.filter(r => r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
export const authorityInstants = (row: { startDate: Date; endDate: Date | null; startTime: string | null; endTime: string | null }) => {
  const startKey = securityDateKey(row.startDate), endKey = securityDateKey(row.endDate || row.startDate);
  const start = new Date(`${startKey}T${row.startTime || '00:00'}:00+03:30`);
  let end = new Date(`${endKey}T${row.endTime || '00:00'}:00+03:30`);
  if (!row.endTime || (!row.endDate && end <= start)) end = dayAfter(end);
  return { start, end };
};
export type AccountingProjection = ReturnType<typeof accountAttendanceDay> & { method: 'WINDOW'; evidenceHash: string; policyId: string | null; assignmentId: string | null; scheduleId: string | null; restWindow: string | null; restAssigned?: boolean | null; scheduleWindow?: string | null; policyEffectiveFrom?: string; assignmentEffectiveFrom?: string | null };

/** Same projection for preview, PDF, leave usage evidence and factual absence decisions. */
export async function loadPersonnelAttendanceAccounting(db: Prisma.TransactionClient, options: PersonnelAttendanceReportOptions, now = new Date()) {
  const selectedPersonnel = options.personnelIds.length ? await db.personnel.findMany({ where: { id: { in: options.personnelIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const catalog = selectedPersonnel.map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }));
  const today = securityDateKey(now);
  const policies = await db.attendanceRestPolicy.findMany({ orderBy: { effectiveFrom: 'asc' } });
  const records = await db.attendanceRecord.findMany({ where: { date: { gte: options.startDate, lt: dayAfter(options.endDate) } }, include: { intervals: { orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }] }, personnel: { select: { firstName: true, lastName: true } }, employee: { select: { id: true, firstName: true, lastName: true, personnelId: true } } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] });
  if (!policies.length || policies[0].effectiveFrom > options.endDate) return buildPersonnelAttendanceReport(records.filter(r => securityDateKey(r.date) <= today), options, catalog);
  const memberships = await db.securityAttendanceRosterMembership.findMany({ where: { effectiveFrom: { lte: options.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: options.startDate } }] }, include: { personnel: { select: { id: true, firstName: true, lastName: true } } } });
  const ids = [...new Set([...records.map(r => r.personnelId || r.employee?.personnelId).filter((id): id is string => Boolean(id)), ...memberships.map(m => m.personnelId)])];
  const people = await db.personnel.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, user: { select: { id: true } }, workSchedules: { include: { days: { orderBy: { weekday: 'asc' } } } } } });
  const userIds = people.flatMap(p => p.user ? [p.user.id] : []);
  const identityFilter = { OR: [{ personnelId: { in: ids } }, { employeeId: { in: userIds } }] };
  const rangeFilter = { startDate: { lte: dayAfter(options.endDate, 2) }, OR: [{ endDate: null }, { endDate: { gte: dayAfter(options.startDate, -1) } }] };
  const [assignments, missions, leaves, punches, decisions] = await Promise.all([
    db.attendanceRestAssignment.findMany({ where: { personnelId: { in: ids }, effectiveFrom: { lte: options.endDate } } }),
    db.missionAssignment.findMany({ where: { AND: [identityFilter, rangeFilter], status: { in: ['APPROVED', 'PENDING'] } }, orderBy: { id: 'asc' } }),
    db.exceptionRequest.findMany({ where: { AND: [identityFilter, rangeFilter], status: { in: ['APPROVED', 'PENDING'] } }, orderBy: { id: 'asc' } }),
    db.attendancePunch.findMany({ where: { personnelId: { in: ids }, status: { in: ['REVIEW', 'DUPLICATE'] }, occurredAt: { gte: dayAfter(options.startDate, -1), lt: dayAfter(options.endDate, 2) } }, select: { id: true, personnelId: true, occurredAt: true, correctedOccurredAt: true, status: true }, orderBy: { id: 'asc' } }),
    db.attendanceAbsenceDecision.findMany({ where: { personnelId: { in: ids }, date: { gte: options.startDate, lte: options.endDate } } }),
  ]);
  const rows: PersonnelAttendanceSourceRow[] = [];
  for (let date = options.startDate; date <= options.endDate; date = dayAfter(date)) {
    const policy = latest(policies, date), key = securityDateKey(date);
    if (key > today) continue;
    const dayRecords = records.filter(r => securityDateKey(r.date) === key);
    if (!policy) { rows.push(...dayRecords); continue; }
    for (const person of people) {
      const ownRecords = dayRecords.filter(r => (r.personnelId || r.employee?.personnelId) === person.id);
      const rostered = memberships.some(m => m.personnelId === person.id && m.effectiveFrom <= date && (!m.effectiveTo || m.effectiveTo > date));
      if (!ownRecords.length && !rostered) continue;
      const scheduleVersion = latest(person.workSchedules, date);
      const scheduleDay = scheduleVersion?.days.find(d => d.weekday === persianWeekdayIndex(date));
      const snapshot = ownRecords.find(r => r.workScheduleStatus === 'WORKDAY' && r.scheduledStartTime && r.scheduledEndTime);
      const schedule = snapshot ? { startTime: snapshot.scheduledStartTime!, endTime: snapshot.scheduledEndTime! } : ownRecords.length && ownRecords.every(r => r.workScheduleStatus === 'UNCONFIGURED') ? undefined : scheduleDay;
      const nonWorkingDay = !schedule && (ownRecords.some(r => r.workScheduleStatus === 'NON_WORKING_DAY') || Boolean(scheduleVersion?.days.length && !scheduleDay));
      const assignment = latest(assignments.filter(a => a.personnelId === person.id), date);
      const forPerson = (r: { personnelId: string | null; employeeId: string | null }) => r.personnelId === person.id || (!r.personnelId && r.employeeId === person.user?.id);
      const authorities: AttendanceAuthority[] = [
        ...missions.filter(forPerson).map(m => ({ id: m.id, kind: 'MISSION' as const, status: m.status, ...authorityInstants(m) })),
        ...leaves.filter(forPerson).filter(l => l.exceptionType !== 'ABSENCE').map(l => ({ id: l.id, kind: l.exceptionType === 'MISSION' ? 'MISSION' as const : 'LEAVE' as const, status: l.status, leaveType: l.leaveType || l.exceptionType, ...authorityInstants(l) })),
      ];
      const intervals = ownRecords.flatMap(r => r.intervals);
      const otherIntervals = records.filter(r => !ownRecords.some(own => own.id === r.id) && (r.personnelId || r.employee?.personnelId) === person.id).flatMap(r => r.intervals);
      const overlappingEvidence = intervals.some(a => a.status !== 'VOIDED' && a.enteredAt && a.exitedAt && otherIntervals.some(b => b.status !== 'VOIDED' && b.enteredAt && b.exitedAt && a.enteredAt! < b.exitedAt && b.enteredAt < a.exitedAt!));
      const start = new Date(`${key}T${schedule?.startTime || '00:00'}:00+03:30`).getTime();
      const end = start + 86400000;
      const ambiguous = punches.filter(p => p.personnelId === person.id && (p.correctedOccurredAt || p.occurredAt).getTime() >= start && (p.correctedOccurredAt || p.occurredAt).getTime() < end);
      const relevantAuthorities = authorities.filter(a => a.start.getTime() < end && a.end.getTime() > start);
      const source = { personnelId: person.id, date: key, policy, assignment: assignment || null, scheduleVersion: scheduleVersion || null, schedule: schedule || null, nonWorkingDay, intervals, overlappingEvidence, authorities: relevantAuthorities, ambiguous };
      const evidenceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
      const absenceConfirmed = decisions.some(d => d.personnelId === person.id && securityDateKey(d.date) === key && d.evidenceHash === evidenceHash);
      const result = accountAttendanceDay({ date: key, now, schedule, nonWorkingDay, rest: policy, hasRest: assignment?.hasRest, intervals, authorities: relevantAuthorities, absenceConfirmed, overlappingEvidence, ambiguousEvidence: Boolean(ambiguous.length) });
      const accounting: AccountingProjection = { ...result, method: 'WINDOW', evidenceHash, policyId: policy.id, assignmentId: assignment?.id || null, scheduleId: scheduleVersion?.id || null, restAssigned: assignment?.hasRest ?? null, scheduleWindow: schedule ? `${schedule.startTime}–${schedule.endTime}` : null, policyEffectiveFrom: securityDateKey(policy.effectiveFrom), assignmentEffectiveFrom: assignment ? securityDateKey(assignment.effectiveFrom) : null, restWindow: assignment?.hasRest ? `${policy.startTime}–${policy.endTime}` : null };
      rows.push({ id: ownRecords[0]?.id || `expected:${person.id}:${key}`, date, personnelId: person.id, employeeId: null, securityPersonnelId: null, personnelFirstName: person.firstName, personnelLastName: person.lastName, intervals, accounting });
    }
    // Preserve legacy identities which have no stable Personnel link, without guessing an assignment.
    rows.push(...dayRecords.filter(r => !(r.personnelId || r.employee?.personnelId)));
  }
  return buildPersonnelAttendanceReport(rows, options, catalog);
}
