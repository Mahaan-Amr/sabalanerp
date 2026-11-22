import { onlyDeferredUnknownTimes } from './attendanceDayBoundary';
import { Prisma } from '@prisma/client';
import { parsePersonnelAttendanceReportOptions } from './personnelAttendanceReport';
import { loadPersonnelAttendanceAccounting } from './personnelAttendanceAccounting';
import { restReason } from './attendanceRestPolicy';
import { parseSecurityBusinessDate, securityDateKey, securityDateKeyFromInstant } from '../utils/securityBusinessDate';

export async function unresolvedAbsenceDays(db: Prisma.TransactionClient, now = new Date()) {
  const first = await db.attendanceRestPolicy.findFirst({ orderBy: { effectiveFrom: 'asc' } });
  const today = parseSecurityBusinessDate(undefined, now);
  if (!first || first.effectiveFrom > today) return [];
  const cases: Array<{ personnelId: string; name: string; date: string; evidenceHash: string; issues: string[]; issueLabels: string[]; requiredMinutes: number | null; canConfirm: boolean; handoverRequired: boolean }> = [];
  for (let from = first.effectiveFrom; from <= today; from = new Date(from.getTime() + 93 * 86400000)) {
    const end = new Date(Math.min(today.getTime(), from.getTime() + 92 * 86400000));
    const options = parsePersonnelAttendanceReportOptions({ startDate: securityDateKey(from), endDate: securityDateKey(end), mergeMatchingNames: false });
    const report = await loadPersonnelAttendanceAccounting(db, options, now);
    for (const person of report.people) for (const day of person.days) {
      const a = day.accounting;
      if (!a || a.issues.includes('OPEN_DAY') || !a.issues.some(issue => ['MISSING_PRESENCE', 'UNKNOWN_TIME', 'OVERLAPPING_ATTENDANCE', 'LEAVE_PRESENCE_CONFLICT', 'OVERLAPPING_LEAVE', 'PENDING_AUTHORITY'].includes(issue))) continue;
      cases.push({ personnelId: person.personnelIds[0], name: person.name, date: day.date, evidenceHash: a.evidenceHash, issues: a.issues, issueLabels: a.issueLabels, requiredMinutes: a.requiredMinutes, handoverRequired: !(onlyDeferredUnknownTimes(day.intervals, securityDateKeyFromInstant(now)) && !a.issues.some(issue => ['MISSING_PRESENCE', 'OVERLAPPING_ATTENDANCE', 'LEAVE_PRESENCE_CONFLICT', 'OVERLAPPING_LEAVE', 'PENDING_AUTHORITY', 'AMBIGUOUS_DEVICE'].includes(issue))), canConfirm: a.issues.includes('MISSING_PRESENCE') && a.issues.every(issue => issue === 'MISSING_PRESENCE') });
    }
  }
  return cases;
}

export async function confirmFactualAbsence(db: Prisma.TransactionClient, input: { personnelId?: unknown; date?: unknown; evidenceHash?: unknown; reason?: unknown; confirmedAbsent?: unknown; confirmedNoAuthorization?: unknown }, actorId: string, now = new Date()) {
  const reason = restReason(input.reason);
  if (input.confirmedAbsent !== true || input.confirmedNoAuthorization !== true) throw new Error('عدم حضور واقعی و نبود مجوز باید صریحاً تأیید شوند.');
  if (typeof input.personnelId !== 'string' || typeof input.date !== 'string' || typeof input.evidenceHash !== 'string') throw new Error('پرونده، تاریخ و نسخه شواهد الزامی‌اند.');
  const options = parsePersonnelAttendanceReportOptions({ startDate: input.date, endDate: input.date, personnelIds: [input.personnelId], mergeMatchingNames: false });
  const report = await loadPersonnelAttendanceAccounting(db, options, now);
  const day = report.people.find(p => p.personnelIds.includes(input.personnelId as string))?.days.find(d => d.date === input.date);
  const accounting = day?.accounting;
  if (!accounting || accounting.evidenceHash !== input.evidenceHash) throw new Error('شواهد تغییر کرده است؛ پرونده را دوباره دریافت کنید.');
  if (!accounting.issues.length || accounting.issues.some(issue => issue !== 'MISSING_PRESENCE')) throw new Error('پیش از تصمیم، برنامه، تخصیص، مجوزها یا ابهام‌های حضور را تعیین تکلیف کنید.');
  return db.attendanceAbsenceDecision.create({ data: { personnelId: input.personnelId, date: parseSecurityBusinessDate(input.date), evidenceHash: accounting.evidenceHash, createdBy: actorId, reason, evidence: { requiredMinutes: accounting.requiredMinutes, policyId: accounting.policyId, assignmentId: accounting.assignmentId, scheduleId: accounting.scheduleId, confirmedAbsent: true, confirmedNoAuthorization: true, authorizationScope: 'UNCOVERED_REQUIRED_TIME' } } });
}
