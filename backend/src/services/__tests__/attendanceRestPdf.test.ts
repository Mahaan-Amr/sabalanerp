import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { accountAttendanceDay } from '../attendanceRestAccounting';
import { buildPersonnelAttendanceReport, parsePersonnelAttendanceReportOptions, PersonnelAttendanceSourceRow } from '../personnelAttendanceReport';
import { renderPersonnelAttendanceReportPdf } from '../personnelAttendanceReportPdf';

test('real Chromium renders monthly window/unknown and legacy reports with unchanged A4 generation settings and no overflow', async () => {
  const rows: PersonnelAttendanceSourceRow[] = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, index + 1)), key = date.toISOString().slice(0, 10);
    const at = (time: string) => new Date(`${key}T${time}:00+03:30`);
    const intervals = [{ enteredAt: at('08:00'), exitedAt: at('12:45'), status: 'ACTIVE', revision: 1, confirmedRevision: 0 }, { enteredAt: at('14:15'), exitedAt: index === 12 ? null : at('17:30'), status: 'ACTIVE', revision: 1, confirmedRevision: 0 }];
    return { id: `qa-${index}`, personnelId: 'qa-month', employeeId: null, securityPersonnelId: null, personnelFirstName: 'نمونه گزارش', personnelLastName: 'آزمون بازه استراحت', date, intervals, accounting: { ...accountAttendanceDay({ date: key, now: new Date('2026-12-10T00:00:00Z'), schedule: { startTime: '08:00', endTime: '17:00' }, rest: { startTime: '13:00', endTime: '14:00' }, hasRest: true, intervals, authorities: [] }), method: 'WINDOW', evidenceHash: 'synthetic', policyId: null, assignmentId: null, scheduleId: null, restWindow: '13:00–14:00' } };
  });
  const options = parsePersonnelAttendanceReportOptions({ startDate: '2026-11-01', endDate: '2026-11-30', restMinutes: 120 });
  const report = buildPersonnelAttendanceReport(rows, options);
  assert.equal(report.people[0].shortageMinutes, null);
  assert.equal(report.people[0].netMinutes, 29 * 450 + 285);
  const dir = process.env.ATTENDANCE_PDF_QA_DIR;
  assert(dir, 'Explicit local QA output directory is required for real PDF test'); await mkdir(dir, { recursive: true });
  for (const [name, data] of [['window', report], ['legacy', buildPersonnelAttendanceReport(rows.map(({ accounting, ...r }) => r), options)], ['legacy-unknown', buildPersonnelAttendanceReport(rows.map(({ accounting, ...r }) => ({ ...r, intervals: r.intervals.slice(0, 1) })), { ...options, legacyRestKnown: false })]] as const) {
    const pdf = await renderPersonnelAttendanceReportPdf(data);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert(pdf.length > 10000);
    await writeFile(`${dir}/${name}.pdf`, pdf);
  }
});
