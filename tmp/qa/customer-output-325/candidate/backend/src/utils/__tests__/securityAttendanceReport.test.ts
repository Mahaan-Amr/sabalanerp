import assert from 'node:assert/strict';
import { AttendanceStatus } from '@prisma/client';
import { renderSecurityAttendanceReportHtml, securityAttendanceStatusLabel } from '../securityAttendanceReport';

assert.equal(securityAttendanceStatusLabel(AttendanceStatus.PRESENT), 'حاضر');
assert.equal(securityAttendanceStatusLabel(AttendanceStatus.NON_WORKING_DAY), 'روز غیرکاری');

const row = { date: '۱۴۰۵/۴/۲۷', employee: 'کارمند اول', department: 'تولید', status: 'حاضر با تأخیر', entryTime: '08:25', exitTime: '17:15', shift: 'صبح', notes: '-', signature: '-', delayMinutes: 25, overtimeMinutes: 15, overtimePending: false };
const singleDay = renderSecurityAttendanceReportHtml({ baseStyles: '<style>body{direction:rtl}</style>', title: 'گزارش گارد شنبه ۱۴۰۵/۴/۲۷', totals: { absent: 1, late: 1 }, rows: [row], showDateColumn: false });
assert.match(singleDay, /کارمند اول/);
assert.match(singleDay, /۲۵ دقیقه/);
assert.match(singleDay, /۱۵ دقیقه/);
assert.doesNotMatch(singleDay, /<th>تاریخ<\/th>/);
assert.doesNotMatch(singleDay, /<th>بخش<\/th>/);
assert.doesNotMatch(singleDay, /کل نفر-روز/);
assert.doesNotMatch(singleDay, /حاضر<\/span>/);

const range = renderSecurityAttendanceReportHtml({ baseStyles: '', title: 'گزارش گارد', totals: { absent: 0, late: 1 }, rows: [row], showDateColumn: true });
assert.match(range, /<th>تاریخ<\/th>/);
console.log('securityAttendanceReport tests passed');
