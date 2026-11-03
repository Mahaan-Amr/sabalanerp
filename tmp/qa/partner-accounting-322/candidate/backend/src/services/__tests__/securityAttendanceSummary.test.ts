import assert from 'node:assert/strict';
import { AttendanceStatus } from '@prisma/client';
import { summarizeSecurityAttendance } from '../securityAttendanceSummary';

const rows = [
  { status: AttendanceStatus.PRESENT, approvedMissions: [], approvedLeaves: [] },
  { status: AttendanceStatus.LATE, approvedMissions: [{ id: 'mission' }], approvedLeaves: [] },
  { status: AttendanceStatus.ABSENT, approvedMissions: [], approvedLeaves: [] },
  { status: AttendanceStatus.VACATION, approvedMissions: [], approvedLeaves: [{ id: 'leave' }] },
  { status: AttendanceStatus.NON_WORKING_DAY, approvedMissions: [], approvedLeaves: [] },
];

const summary = summarizeSecurityAttendance(rows, [
  { digitalSignature: 'signed' },
  { digitalSignature: null },
]);

assert.deepEqual(summary, {
  totalEmployees: 4,
  present: 1,
  absent: 1,
  late: 1,
  mission: 1,
  leave: 1,
  exception: 2,
  signed: 1,
});

console.log('security attendance summary tests passed');
