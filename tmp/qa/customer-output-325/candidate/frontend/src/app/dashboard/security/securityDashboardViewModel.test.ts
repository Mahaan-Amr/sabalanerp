import assert from 'node:assert/strict';
import {
  buildTodayStatusItems,
  buildSecurityQuickAccess,
  getNeedsAttention,
  matchesAttendanceFilter,
  parseAttendanceDashboardQuery,
} from './securityDashboardViewModel';

const statusItems = buildTodayStatusItems({ absent: 3, late: 2, mission: 1, leave: 0 }, '1405/05/01');

assert.deepEqual(
  statusItems.map(({ id, label, value }) => ({ id, label, value })),
  [
    { id: 'absent', label: 'غایب', value: 3 },
    { id: 'late', label: 'تأخیر', value: 2 },
    { id: 'mission', label: 'مأموریت', value: 1 },
    { id: 'leave', label: 'مرخصی', value: 0 },
  ],
);
assert.equal(statusItems[0].href, '/dashboard/security/attendance?date=1405%2F05%2F01&status=ABSENT');
assert.equal(statusItems[2].href, '/dashboard/security/attendance?date=1405%2F05%2F01&condition=MISSION');
assert.equal(statusItems[3].href, '/dashboard/security/attendance?date=1405%2F05%2F01&condition=LEAVE');

const attendanceRows = [
  { id: 'absent-1', status: 'ABSENT', delayMinutes: null, approvedMissions: [], approvedExceptions: [], approvedLeaves: [] },
  { id: 'late-10', status: 'LATE', delayMinutes: 10, approvedMissions: [], approvedExceptions: [], approvedLeaves: [] },
  { id: 'late-45', status: 'LATE', delayMinutes: 45, approvedMissions: [{ id: 'mission' }], approvedExceptions: [], approvedLeaves: [] },
  { id: 'present-leave', status: 'PRESENT', delayMinutes: 0, approvedMissions: [], approvedExceptions: [{ id: 'absence' }], approvedLeaves: [{ id: 'leave' }] },
  { id: 'present-non-leave-exception', status: 'PRESENT', delayMinutes: 0, approvedMissions: [], approvedExceptions: [{ id: 'absence' }], approvedLeaves: [] },
];

assert.equal(matchesAttendanceFilter(attendanceRows[2], 'ALL', 'MISSION'), true);
assert.equal(matchesAttendanceFilter(attendanceRows[3], 'ALL', 'LEAVE'), true);
assert.equal(matchesAttendanceFilter(attendanceRows[4], 'ALL', 'LEAVE'), false);
assert.equal(matchesAttendanceFilter(attendanceRows[3], 'ABSENT', null), false);

assert.deepEqual(parseAttendanceDashboardQuery(new URLSearchParams('date=1405%2F05%2F01&condition=MISSION')), {
  date: '1405/05/01',
  status: 'ALL',
  condition: 'MISSION',
});
assert.deepEqual(parseAttendanceDashboardQuery(new URLSearchParams('date=invalid&status=ABSENT')), {
  date: null,
  status: 'ABSENT',
  condition: null,
});

const attention = getNeedsAttention(attendanceRows, 1);
assert.deepEqual(attention.absent.map((row) => row.id), ['absent-1']);
assert.deepEqual(attention.late.map((row) => row.id), ['late-45']);
assert.equal(attention.absentTotal, 1);
assert.equal(attention.lateTotal, 2);

assert.deepEqual(
  buildSecurityQuickAccess(false).map((item) => item.id),
  ['attendance', 'vehicles', 'exceptions', 'shifts'],
);
assert.deepEqual(
  buildSecurityQuickAccess(false, true).map((item) => item.id),
  ['attendance', 'shift-report', 'vehicles', 'exceptions', 'shifts'],
);
assert.deepEqual(
  buildSecurityQuickAccess(true).map((item) => item.id),
  ['attendance', 'shift-report', 'vehicles', 'exceptions', 'shifts', 'reports', 'personnel'],
);
assert.equal(buildSecurityQuickAccess(true)[3].title, 'استثناها و مأموریت‌ها');

console.log('securityDashboardViewModel tests passed');
