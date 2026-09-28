import assert from 'node:assert/strict';
import { AttendanceIntervalStatus } from '@prisma/client';
import { buildPersonnelAttendanceReport, parsePersonnelAttendanceReportOptions, PersonnelAttendanceSourceRow } from '../personnelAttendanceReport';

const options = parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-09-22' });
assert.equal(options.restMinutes, 120);
assert.throws(() => parsePersonnelAttendanceReportOptions({ startDate: '2026-02-30', endDate: '2026-03-01' }));
assert.throws(() => parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-12-01' }));
assert.throws(() => parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-09-22', restMinutes: 241 }));

const row = (id: string, personnelId: string, date: string, intervals: PersonnelAttendanceSourceRow['intervals']): PersonnelAttendanceSourceRow => ({
  id, personnelId, date: new Date(`${date}T00:00:00Z`), employeeId: null, securityPersonnelId: null,
  personnelFirstName: 'آریا', personnelLastName: 'متانت', intervals,
});
const interval = (enteredAt: string, exitedAt: string | null, status: AttendanceIntervalStatus = AttendanceIntervalStatus.ACTIVE) => ({
  enteredAt: new Date(enteredAt), exitedAt: exitedAt ? new Date(exitedAt) : null, status,
});
const rows = [
  row('one', 'a', '2026-08-23', [
    interval('2026-08-23T05:00:00Z', '2026-08-23T06:30:00Z'),
    interval('2026-08-23T07:00:00Z', '2026-08-23T08:00:00Z'),
    interval('2026-08-23T08:30:00Z', '2026-08-23T09:00:00Z', AttendanceIntervalStatus.VOIDED),
  ]),
  row('two', 'b', '2026-08-23', [interval('2026-08-23T09:00:00Z', '2026-08-23T10:00:00Z')]),
  row('three', 'a', '2026-08-24', []),
  row('four', 'a', '2026-08-25', [interval('2026-08-25T05:00:00Z', null)]),
  row('five', 'a', '2026-08-26', [interval('2026-08-26T05:00:00Z', '2026-08-26T06:00:00Z')]),
];

const merged = buildPersonnelAttendanceReport(rows, options);
assert.equal(merged.availablePeople.length, 2);
assert.equal(merged.people.length, 1);
assert.equal(merged.people[0].days.length, 4);
assert.equal(merged.people[0].days[0].grossMinutes, 210);
assert.equal(merged.people[0].days[0].netMinutes, 90, 'Daily rest is deducted once after same-name rows merge');
assert.equal(merged.people[0].days[3].netMinutes, 0, 'A short completed day cannot produce negative worktime');
assert.equal(merged.people[0].grossMinutes, 270);
assert.equal(merged.people[0].netMinutes, 90);
assert.equal(merged.voidedIntervals, 1);
assert.equal(merged.openIntervals, 1);

const separate = buildPersonnelAttendanceReport(rows, { ...options, mergeMatchingNames: false, includeNoMovement: false, personnelIds: ['a'] });
assert.equal(separate.people.length, 1);
assert.equal(separate.people[0].days.length, 3);
assert.equal(separate.people[0].days[0].grossMinutes, 150);
assert.equal(separate.people[0].days[0].netMinutes, 30);
assert.equal(separate.people[0].days[1].grossMinutes, 0);
assert.equal(separate.people[0].days[1].netMinutes, 0);
assert.throws(() => buildPersonnelAttendanceReport(rows, { ...options, personnelIds: ['missing'] }));

console.log('personnel attendance report tests passed');
