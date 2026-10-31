import assert from 'node:assert/strict';
import test from 'node:test';
import { accountAttendanceDay, businessSpan } from '../attendanceRestAccounting';

const at = (clock: string) => new Date(`2026-10-21T${clock}:00+03:30`);
const base = () => ({ date: '2026-10-21', now: at('20:00'), schedule: { startTime: '08:00', endTime: '17:00' }, rest: { startTime: '13:00', endTime: '14:00' }, hasRest: true, intervals: [{ enteredAt: at('08:00'), exitedAt: at('17:00') }], authorities: [], absenceConfirmed: false });

test('ordinary time excludes the assigned rest once whether the employee stays or leaves', () => {
  const continuous = accountAttendanceDay(base());
  assert.equal(continuous.workMinutes, 480);
  assert.equal(continuous.physicalMinutes, 540);
  assert.equal(continuous.shortageMinutes, 0);
  const split = accountAttendanceDay({ ...base(), intervals: [{ enteredAt: at('08:00'), exitedAt: at('13:00') }, { enteredAt: at('14:00'), exitedAt: at('17:00') }] });
  assert.equal(split.workMinutes, 480);
  assert.equal(split.shortageMinutes, 0);
});

test('absence crossing rest edges counts only thirty minutes and does not net against extra presence', () => {
  const result = accountAttendanceDay({ ...base(), intervals: [{ enteredAt: at('08:00'), exitedAt: at('12:45') }, { enteredAt: at('14:15'), exitedAt: at('17:30') }] });
  assert.equal(result.workMinutes, 450);
  assert.equal(result.shortageMinutes, 30);
  assert.equal(result.outsideScheduleMinutes, 30);
});
test('explicit no-rest entitlement does not exempt the common window; unknown is not no-rest', () => {
  const intervals = [{ enteredAt: at('08:00'), exitedAt: at('13:00') }, { enteredAt: at('14:00'), exitedAt: at('17:00') }];
  assert.equal(accountAttendanceDay({ ...base(), hasRest: false, intervals }).shortageMinutes, 60);
  const unknown = accountAttendanceDay({ ...base(), hasRest: undefined, intervals });
  assert.equal(unknown.workMinutes, null); assert.equal(unknown.shortageMinutes, null);
  assert.ok(unknown.issues.includes('REST_UNASSIGNED'));
});
test('approved mission covers duty without adding physical presence or counting rest twice', () => {
  const result = accountAttendanceDay({ ...base(), intervals: [{ enteredAt: at('08:00'), exitedAt: at('10:00') }, { enteredAt: at('12:00'), exitedAt: at('17:00') }], authorities: [{ kind: 'MISSION', status: 'APPROVED', start: at('10:00'), end: at('14:00') }] });
  assert.equal(result.workMinutes, 480); assert.equal(result.physicalMinutes, 420);
  assert.equal(result.missionMinutes, 120); assert.equal(result.shortageMinutes, 0);
});
test('12:30–14:30 approved leave consumes sixty required minutes around 13–14 rest', () => {
  const result = accountAttendanceDay({ ...base(), intervals: [{ enteredAt: at('08:00'), exitedAt: at('12:30') }, { enteredAt: at('14:30'), exitedAt: at('17:00') }], authorities: [{ id: 'leave', kind: 'LEAVE', status: 'APPROVED', start: at('12:30'), end: at('14:30') }] });
  assert.equal(result.workMinutes, 420); assert.equal(result.leaveMinutes, 60); assert.equal(result.shortageMinutes, 0);
  assert.equal(result.leaveConsumptions[0].minutes, 60);
});
test('pending leave and leave conflicting with physical presence prevent a final decision', () => {
  const leave = { kind: 'LEAVE' as const, status: 'PENDING', start: at('10:00'), end: at('12:00') };
  assert.equal(accountAttendanceDay({ ...base(), authorities: [leave] }).shortageMinutes, null);
  const conflict = accountAttendanceDay({ ...base(), authorities: [{ ...leave, status: 'APPROVED' }] });
  assert.ok(conflict.issues.includes('LEAVE_PRESENCE_CONFLICT'));
  assert.equal(conflict.leaveMinutes, null); assert.equal(conflict.leaveConsumptions[0].minutes, null);
  assert.equal(conflict.physicalMinutes, 540);
});
test('unknown boundaries, ambiguous evidence and legacy overlapping intervals never finalize shortage', () => {
  for (const changes of [{ intervals: [{ enteredAt: at('08:00'), exitedAt: null }] }, { ambiguousEvidence: true }, { intervals: [...base().intervals, { enteredAt: at('09:00'), exitedAt: at('10:00') }] }]) {
    const result = accountAttendanceDay({ ...base(), ...changes });
    assert.equal(result.shortageMinutes, null); assert.equal(result.final, false);
  }
});
test('missing presence is not confirmed absence; known authorized absence may finalize full required shortage', () => {
  const missing = accountAttendanceDay({ ...base(), intervals: [] });
  assert.equal(missing.shortageMinutes, null); assert.ok(missing.issues.includes('MISSING_PRESENCE'));
  assert.equal(accountAttendanceDay({ ...base(), intervals: [], absenceConfirmed: true }).shortageMinutes, 480);
  assert.equal(accountAttendanceDay({ ...base(), schedule: undefined }).shortageMinutes, null);
});
test('unfinished shift never counts future hours as final shortage or invents an exit', () => {
  const result = accountAttendanceDay({ ...base(), now: at('11:00'), intervals: [{ enteredAt: at('08:00'), exitedAt: null }] });
  assert.equal(result.shortageMinutes, null); assert.ok(result.issues.includes('OPEN_DAY'));
  assert.equal(result.physicalMinutes, 0);
});
test('overnight rest uses real overlap and work belongs to shift-start date', () => {
  const midnight = new Date('2026-10-22T06:00:00+03:30');
  const input = { ...base(), now: new Date('2026-10-22T07:00:00+03:30'), schedule: { startTime: '22:00', endTime: '06:00' }, intervals: [{ enteredAt: at('22:00'), exitedAt: midnight }] };
  assert.equal(accountAttendanceDay(input).workMinutes, 480);
  assert.equal(accountAttendanceDay({ ...input, rest: { startTime: '23:30', endTime: '00:30' } }).workMinutes, 420);
  assert.equal(businessSpan('2026-10-21', '22:00', '06:00').end, midnight.getTime());
});
test('forty-second absences aggregate to one daily minute, not zero per boundary', () => {
  const addSeconds = (clock: string, seconds: number) => new Date(at(clock).getTime() + seconds * 1000);
  const result = accountAttendanceDay({ ...base(), intervals: [{ enteredAt: at('08:00'), exitedAt: at('10:00') }, { enteredAt: addSeconds('10:00', 40), exitedAt: at('11:00') }, { enteredAt: addSeconds('11:00', 40), exitedAt: at('17:00') }] });
  assert.equal(result.shortageMinutes, 1);
});

test('overlapping leave sources and unknown attendance cannot finalize consumed leave', () => {
  const at = (time: string) => new Date(`2026-10-21T${time}:00+03:30`);
  const input = { date: '2026-10-21', now: new Date('2026-10-22T12:00:00Z'), schedule: { startTime: '08:00', endTime: '17:00' }, hasRest: false, intervals: [], authorities: [
    { id: 'paid', kind: 'LEAVE' as const, status: 'APPROVED', start: at('10:00'), end: at('12:00'), leaveType: 'PAID' },
    { id: 'unpaid', kind: 'LEAVE' as const, status: 'APPROVED', start: at('11:00'), end: at('13:00'), leaveType: 'UNPAID' },
  ] };
  const overlap = accountAttendanceDay(input);
  assert(overlap.issues.includes('OVERLAPPING_LEAVE')); assert.equal(overlap.leaveMinutes, null); assert(overlap.leaveConsumptions.every(l => l.minutes === null));
  const unknown = accountAttendanceDay({ ...input, authorities: input.authorities.slice(0, 1), intervals: [{ enteredAt: at('08:00'), exitedAt: null }] });
  assert.equal(unknown.leaveMinutes, null); assert.equal(unknown.leaveConsumptions[0].minutes, null);
});
