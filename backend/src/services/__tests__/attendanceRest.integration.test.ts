import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { saveRestPolicy, assignRestPolicy } from '../attendanceRestPolicy';
import { loadPersonnelAttendanceAccounting } from '../personnelAttendanceAccounting';
import { parsePersonnelAttendanceReportOptions } from '../personnelAttendanceReport';
import { confirmFactualAbsence, unresolvedAbsenceDays } from '../attendanceAbsenceDecision';
import { lockAttendance } from '../attendanceDevice';
if (!process.env.DATABASE_URL?.includes('@127.0.0.1:55432/sabalanerp?') && !(process.env.ATTENDANCE_DOCKER_FIXTURE === '1' && new URL(process.env.DATABASE_URL!).hostname === 'postgres' && new URL(process.env.DATABASE_URL!).pathname === '/sabalanerp')) throw new Error('Existing local Docker only');
const db = new PrismaClient();
test.after(() => db.$disconnect());
const rollback = new Error('rollback rest fixture');
const day = '2026-11-02', date = new Date(`${day}T00:00:00Z`), now = new Date('2026-11-04T12:00:00Z');
const instant = (time: string) => new Date(`${day}T${time}:00+03:30`);
async function fixture(work: (tx: Prisma.TransactionClient, f: any) => Promise<void>) {
  await assert.rejects(db.$transaction(async tx => {
    await lockAttendance(tx);
    const key = randomUUID();
    const actor = await tx.user.create({ data: { username: key, email: `${key}@example.invalid`, firstName: 'آزمون', lastName: 'استراحت', password: 'unused', role: 'ADMIN' } });
    const person = await tx.personnel.create({ data: { firstName: 'نمونه', lastName: key } });
    await tx.securityAttendanceRosterMembership.create({ data: { personnelId: person.id, effectiveFrom: date, createdBy: actor.id } });
    await tx.personnelWorkSchedule.create({ data: { personnelId: person.id, effectiveFrom: date, days: { create: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startTime: '08:00', endTime: '17:00' })) } } });
    await saveRestPolicy(tx, { effectiveDate: day, startTime: '13:00', endTime: '14:00', reason: 'نسخه آزمایشی تراکنشی' }, actor.id);
    const report = async (extra = {}) => loadPersonnelAttendanceAccounting(tx, parsePersonnelAttendanceReportOptions({ startDate: day, endDate: day, personnelIds: [person.id], ...extra }), now);
    const accounting = async () => (await report()).people[0].days[0].accounting!;
    const interval = async (entry: string, exit: string | null) => {
      let record = await tx.attendanceRecord.findFirst({ where: { personnelId: person.id, date } });
      if (!record) record = await tx.attendanceRecord.create({ data: { personnelId: person.id, date, status: 'PRESENT', workScheduleStatus: 'WORKDAY', scheduledStartTime: '08:00', scheduledEndTime: '17:00' } });
      return tx.attendanceInterval.create({ data: { attendanceRecordId: record.id, enteredAt: instant(entry), exitedAt: exit ? instant(exit) : null, entryRecordedBy: actor.id, revision: 1, confirmedRevision: 0 } });
    };
    await work(tx, { actor, person, report, accounting, interval });
    throw rollback;
  }, { isolationLevel: 'Serializable', timeout: 60000 }), error => error === rollback);
}
test('effective assignment remains unknown until explicit HR choice; versions and audit are append-only', () => fixture(async (tx, f) => {
  assert.equal((await f.accounting()).workMinutes, null);
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص صریح' }, f.actor.id);
  assert.equal((await f.accounting()).requiredMinutes, 480);
  await assert.rejects(assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: false, reason: 'بازنویسی ممنوع' }, f.actor.id), /نسخه|تاریخ/);
  await assert.rejects(saveRestPolicy(tx, { effectiveDate: day, startTime: '12:00', endTime: '13:00', reason: 'بازنویسی ممنوع' }, f.actor.id), /نسخه/);
  assert.equal(await tx.hrPersonnelAudit.count({ where: { personnelId: f.person.id, eventType: 'ATTENDANCE_REST_ASSIGNED' } }), 1);
  assert.equal(await tx.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));
test('ordinary valid unconfirmed manual/device intervals count; rest-edge absence is thirty minutes with no human signature', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص' }, f.actor.id);
  await f.interval('08:00', '12:45'); await f.interval('14:15', '17:30');
  const a = await f.accounting(); assert.equal(a.physicalMinutes, 480); assert.equal(a.workMinutes, 450); assert.equal(a.shortageMinutes, 30); assert.equal(a.outsideScheduleMinutes, 30); assert.equal(a.final, true);
  assert.equal(await tx.attendanceInterval.count({ where: { attendanceRecord: { personnelId: f.person.id }, confirmedBy: { not: null } } }), 0);
}));
test('approved leave usage is sixty minutes with immutable request duration; cancellation and return conflict reproject', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص' }, f.actor.id);
  await f.interval('08:00', '12:30'); await f.interval('14:30', '17:00');
  const leave = await tx.exceptionRequest.create({ data: { personnelId: f.person.id, exceptionType: 'HOURLY_LEAVE', status: 'APPROVED', leaveType: 'PAID', startDate: date, startTime: '12:30', endTime: '14:30', duration: 120, reason: 'مرخصی آزمایشی' } });
  let a = await f.accounting(); assert.equal(a.leaveMinutes, 60); assert.equal(a.shortageMinutes, 0); assert.equal(a.leaveConsumptions[0].id, leave.id); assert.equal(a.leaveConsumptions[0].minutes, 60);
  assert.equal((await tx.exceptionRequest.findUniqueOrThrow({ where: { id: leave.id } })).duration, 120);
  const fingerprint = a.evidenceHash; assert.equal((await f.accounting()).evidenceHash, fingerprint);
  await tx.exceptionRequest.update({ where: { id: leave.id }, data: { status: 'CANCELLED' } });
  assert.equal((await f.accounting()).shortageMinutes, 60); assert.notEqual((await f.accounting()).evidenceHash, fingerprint);
  await tx.exceptionRequest.update({ where: { id: leave.id }, data: { status: 'APPROVED', endTime: '15:00' } });
  a = await f.accounting(); assert.equal(a.leaveMinutes, null); assert.equal(a.shortageMinutes, null); assert(a.issues.includes('LEAVE_PRESENCE_CONFLICT')); assert.equal(a.workMinutes, 420);
}));
test('missing presence needs explicit facts; stale decisions fail and later source evidence invalidates an old decision', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص' }, f.actor.id);
  const a = await f.accounting(); assert.equal(a.shortageMinutes, null);
  const cases = await unresolvedAbsenceDays(tx, now); assert(cases.some(c => c.personnelId === f.person.id && c.date === day && c.canConfirm));
  const command = { personnelId: f.person.id, date: day, evidenceHash: a.evidenceHash, reason: 'بررسی واقعی در داده آزمایشی', confirmedAbsent: true, confirmedNoAuthorization: true };
  await assert.rejects(confirmFactualAbsence(tx, { ...command, confirmedAbsent: 'true' }, f.actor.id, now), /صریح/);
  await assert.rejects(confirmFactualAbsence(tx, { ...command, evidenceHash: 'old' }, f.actor.id, now), /شواهد/);
  await confirmFactualAbsence(tx, command, f.actor.id, now);
  assert.equal((await f.accounting()).shortageMinutes, 480);
  assert.equal(await tx.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
  await f.interval('08:00', null);
  const changed = await f.accounting(); assert.equal(changed.shortageMinutes, null); assert(changed.issues.includes('UNKNOWN_TIME'));
  assert.equal(await tx.attendanceAbsenceDecision.count({ where: { personnelId: f.person.id } }), 1);
}));
test('new policy does not backfill legacy days; identical names remain separate and mission-only days remain visible', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص' }, f.actor.id);
  await tx.missionAssignment.create({ data: { personnelId: f.person.id, assignedBy: f.actor.id, missionType: 'INTERNAL', missionLocation: 'آزمون', missionPurpose: 'آزمون', startDate: date, startTime: '08:00', endTime: '17:00', status: 'APPROVED' } });
  const r = await f.report({ includeNoMovement: false }); assert.equal(r.people[0].days[0].accounting?.missionMinutes, 480); assert.equal(r.people[0].days[0].netMinutes, 480);
  const firstPolicy = await tx.attendanceRestPolicy.findFirstOrThrow({ orderBy: { effectiveFrom: 'asc' } });
  const legacyDate = new Date(firstPolicy.effectiveFrom.getTime() - 86400000);
  const legacyKey = legacyDate.toISOString().slice(0, 10);
  const past = await tx.attendanceRecord.create({ data: { personnelId: f.person.id, date: legacyDate, status: 'PRESENT' } });
  await tx.attendanceInterval.create({ data: { attendanceRecordId: past.id, enteredAt: new Date(`${legacyKey}T08:00:00+03:30`), exitedAt: new Date(`${legacyKey}T17:00:00+03:30`), entryRecordedBy: f.actor.id } });
  const mixed = await loadPersonnelAttendanceAccounting(tx, parsePersonnelAttendanceReportOptions({ startDate: legacyKey, endDate: day, personnelIds: [f.person.id], restMinutes: 120 }), now);
  assert.equal(mixed.people[0].days[0].method, 'LEGACY'); assert.equal(mixed.people[0].days[0].netMinutes, 420); assert.equal(mixed.people[0].days[1].netMinutes, 480); assert.equal(mixed.mergeMatchingNames, false);
}));

test('factual absence covers only remaining duty; approved partial leave remains consumed and unknown-time days remain reviewable', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: true, reason: 'تخصیص' }, f.actor.id);
  await tx.exceptionRequest.create({ data: { personnelId: f.person.id, exceptionType: 'HOURLY_LEAVE', status: 'APPROVED', startDate: date, startTime: '12:30', endTime: '14:30', duration: 120, reason: 'مرخصی معتبر' } });
  const a = await f.accounting(); assert.equal(a.leaveMinutes, 60); assert.equal(a.shortageMinutes, null);
  const cases = await unresolvedAbsenceDays(tx, now); assert(cases.some(c => c.personnelId === f.person.id && c.date === day && c.canConfirm));
  await confirmFactualAbsence(tx, { personnelId: f.person.id, date: day, evidenceHash: a.evidenceHash, reason: 'عدم حضور واقعی در ساعات باقی‌مانده بدون مجوز دیگر', confirmedAbsent: true, confirmedNoAuthorization: true }, f.actor.id, now);
  assert.equal((await f.accounting()).shortageMinutes, 420); assert.equal((await f.accounting()).leaveMinutes, 60);
  await f.interval('08:00', null);
  const changed = (await unresolvedAbsenceDays(tx, now)).find(c => c.personnelId === f.person.id && c.date === day);
  assert(changed); assert.equal(changed.canConfirm, false); assert(changed.issues.includes('UNKNOWN_TIME'));
}));


test('rest settings save without a manually entered reason while retaining actor, effective version and audit', () => fixture(async (tx, f) => {
  const policy = await saveRestPolicy(tx, { effectiveDate: '2026-11-03', startTime: '12:00', endTime: '13:00' }, f.actor.id);
  assert.equal(policy.createdBy, f.actor.id); assert(policy.reason.trim());
  const [assignment] = await assignRestPolicy(tx, { effectiveDate: day, personnelIds: [f.person.id], hasRest: false }, f.actor.id);
  assert.equal(assignment.createdBy, f.actor.id); assert.equal(assignment.hasRest, false); assert(assignment.reason.trim());
  const audit = await tx.hrPersonnelAudit.findFirstOrThrow({ where: { personnelId: f.person.id, eventType: 'ATTENDANCE_REST_ASSIGNED' } });
  assert.equal(audit.actorUserId, f.actor.id); assert.equal((audit.payloadJson as any).assignmentId, assignment.id);
  await assert.rejects(assignRestPolicy(tx, { effectiveDate: '2026-11-03', personnelIds: [f.person.id], hasRest: true, reason: ' ' }, f.actor.id), /دلیل/);
}));

test('report filters retain known personnel, isolate selected policy and omit future days without writes', () => fixture(async (tx, f) => {
  await assignRestPolicy(tx, { personnelIds: [f.person.id], effectiveDate: day, hasRest: false }, f.actor.id);
  const empty = await f.report({ includeNoMovement: false });
  assert.equal(empty.people.length, 0);
  assert(empty.availablePeople.some((p: { id: string }) => p.id === f.person.id));
  const r = await f.report();
  assert.equal(r.hasLegacyPolicy, false);
  const a = r.people[0].days[0].accounting;
  assert.equal(a.restAssigned, false); assert.equal(a.scheduleWindow, '08:00–17:00');
  assert.equal(a.requiredMinutes, 540); assert.equal(a.assignmentEffectiveFrom, day);
  const future = await loadPersonnelAttendanceAccounting(tx, parsePersonnelAttendanceReportOptions({ startDate: day, endDate: '2026-11-06', personnelIds: [f.person.id] }), now);
  assert(future.people[0].days.every(d => d.date <= '2026-11-04'));
  const past = await loadPersonnelAttendanceAccounting(tx, parsePersonnelAttendanceReportOptions({ startDate: '2026-08-01', endDate: '2026-08-01', personnelIds: [f.person.id] }), now);
  assert.equal(past.people.length, 0); assert(past.availablePeople.some(p => p.id === f.person.id));
  assert.equal(await tx.attendanceRecord.count({ where: { personnelId: f.person.id } }), 0);
}));
