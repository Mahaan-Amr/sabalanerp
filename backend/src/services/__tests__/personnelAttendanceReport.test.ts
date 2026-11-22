import assert from 'node:assert/strict';
import { AttendanceIntervalStatus } from '@prisma/client';
import { buildPersonnelAttendanceReport, parsePersonnelAttendanceReportOptions, PersonnelAttendanceSourceRow } from '../personnelAttendanceReport';

const options = parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-09-22', restMinutes: 120 });
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

const uncertain = buildPersonnelAttendanceReport([
  row('uncertain', 'u', '2026-08-23', [{ ...interval('2026-08-23T08:00:00Z', null), exitUnknown: true, revision: 2, confirmedRevision: 0 }]),
], options);
assert.equal(uncertain.people[0].durationUnknown, true, 'Unknown exit is not a final zero-hour day');
assert.equal(uncertain.people[0].provisional, true, 'Unconfirmed source is marked provisional in reporting');

const mixed = buildPersonnelAttendanceReport([row('mixed', 'm', '2026-08-23', [
  interval('2026-08-23T05:00:00Z', '2026-08-23T07:00:00Z'),
  { enteredAt: null, exitedAt: new Date('2026-08-23T14:00:00Z'), status: AttendanceIntervalStatus.ACTIVE },
])], options);
assert.equal(mixed.people[0].grossMinutes, 120);
assert.equal(mixed.people[0].durationUnknown, true);
assert.equal(mixed.people[0].days[0].intervals.find(i => !i.enteredAt)?.enteredAt, null);

assert.ok(mixed.people[0].days[0].intervals[0].enteredAt, 'Known entry times remain ordered before unplaced unknown entries');

const legacyUnknown = buildPersonnelAttendanceReport(rows, parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-09-22' }));
assert.equal(legacyUnknown.people[0].days[0].legacyRestKnown, false);
assert.equal(legacyUnknown.people[0].provisional, true, 'Unrecorded historical rest input is not an exact reconstruction');

// New accounting is stable-person scoped and period totals sum the displayed daily minutes.
const { accountAttendanceDay } = require('../attendanceRestAccounting') as typeof import('../attendanceRestAccounting');
const windowRows = ['a', 'b'].flatMap(id => ['2026-08-23', '2026-08-24'].map(date => {
  const intervals = [interval(`${date}T08:00:00+03:30`, `${date}T08:00:40+03:30`)];
  return { ...row(`${id}:${date}`, id, date, intervals), accounting: {
    ...accountAttendanceDay({ date, now: new Date('2026-09-01T00:00:00Z'), schedule: { startTime: '08:00', endTime: '17:00' }, hasRest: false, intervals, authorities: [] }),
    method: 'WINDOW' as const, evidenceHash: 'fixture', policyId: 'fixture', assignmentId: 'fixture', scheduleId: 'fixture', restWindow: null,
  } };
}));
const windowReport = buildPersonnelAttendanceReport(windowRows, options);
assert.equal(windowReport.people.length, 2, 'Same names never merge distinct stable Personnel with assigned policy');
assert(windowReport.people.every(p => p.netMinutes === 0), 'Two forty-second days stay 0 + 0 minutes, not one period minute');
assert(windowReport.people.every(p => p.shortageMinutes === 1078));

const selectedWindow = buildPersonnelAttendanceReport([...windowRows, row('unselected-legacy', 'unselected', '2026-08-23', [])], { ...options, personnelIds: ['b'], mergeMatchingNames: false });
assert.equal(selectedWindow.hasLegacyPolicy, false, 'Unselected legacy rows must not affect PDF notes or fields');
assert.equal(selectedWindow.hasWindowPolicy, true);
const selectedLegacy = buildPersonnelAttendanceReport([windowRows[0], row('legacy-only', 'legacy-only', '2026-08-23', [])], { ...options, personnelIds: ['legacy-only'] });
assert.equal(selectedLegacy.hasWindowPolicy, false, 'Unselected window rows must not disable legacy grouping');
const emptySelection = buildPersonnelAttendanceReport([row('empty', 'empty', '2026-08-23', [])], { ...options, personnelIds: ['empty'], includeNoMovement: false });
assert.equal(emptySelection.people.length, 0);
assert.equal(emptySelection.availablePeople.length, 1, 'Movement filter preserves personnel selection');
const noRows = buildPersonnelAttendanceReport([], { ...options, personnelIds: ['known'] }, [{ id: 'known', name: 'Known personnel' }]);
assert.equal(noRows.people.length, 0);
assert.equal(noRows.availablePeople[0].id, 'known', 'Known selected personnel remain valid across an empty date range');
const knownPhysical = buildPersonnelAttendanceReport([rows[0]], { ...options, legacyRestKnown: false });
assert.equal(knownPhysical.people[0].physicalDurationUnknown, false, 'Missing historical rest does not make known physical time incomplete');
assert.equal(knownPhysical.people[0].netCalculationUnknown, true);
assert.equal(uncertain.people[0].days[0].intervals[0].exitUnknown, true, 'Forgotten exit remains distinguishable from an ongoing interval');
