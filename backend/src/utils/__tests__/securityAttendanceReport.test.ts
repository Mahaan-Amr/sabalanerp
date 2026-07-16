import assert from 'node:assert/strict';
import { AttendanceStatus } from '@prisma/client';
import { renderSecurityAttendanceReportHtml, securityAttendanceStatusLabel } from '../securityAttendanceReport';

assert.equal(securityAttendanceStatusLabel(AttendanceStatus.PRESENT), 'حاضر');
assert.equal(securityAttendanceStatusLabel(AttendanceStatus.ABSENT), 'غایب');

const html = renderSecurityAttendanceReportHtml({
  baseStyles: '<style>body{direction:rtl}</style>',
  title: 'گزارش آزمایشی',
  generatedAt: '۱۴۰۵/۴/۲۴، ۱۲:۰۰',
  totals: { total: 2, present: 1, absent: 1, late: 0 },
  rows: [
    { date: '۱۴۰۵/۴/۲۴', employee: 'کارمند اول', department: 'تولید', status: 'حاضر', entryTime: '۰۷:۰۰', exitTime: '۱۷:۰۰', shift: 'صبح', notes: '-', signature: 'ثبت شده' },
    { date: '۱۴۰۵/۴/۲۴', employee: 'کارمند دوم', department: 'فروش', status: 'غایب', entryTime: '-', exitTime: '-', shift: '-', notes: 'بدون ورود', signature: '-' }
  ]
});

assert.match(html, /خروجی تفصیلی حضور و غیاب کارکنان/);
assert.match(html, /کارمند اول/);
assert.match(html, /کارمند دوم/);
assert.match(html, /بخش/);
assert.match(html, /شیفت ثبت/);
assert.match(html, /یادداشت/);
assert.match(html, /۲ ردیف پرسنل/);

console.log('securityAttendanceReport tests passed');
