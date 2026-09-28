import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AttendanceIntervalStatus } from '@prisma/client';
import { buildPersonnelAttendanceReport, parsePersonnelAttendanceReportOptions } from '../personnelAttendanceReport';
import { renderPersonnelAttendanceReportPdf } from '../personnelAttendanceReportPdf';

const options = parsePersonnelAttendanceReportOptions({ startDate: '2026-08-23', endDate: '2026-08-24', restMinutes: 120 });
const report = buildPersonnelAttendanceReport([
  {
    id: 'sample-1', date: new Date('2026-08-23T00:00:00Z'), personnelId: 'person-1', employeeId: null,
    securityPersonnelId: null, personnelFirstName: 'آریا', personnelLastName: 'متانت',
    intervals: [{ enteredAt: new Date('2026-08-23T05:00:00Z'), exitedAt: new Date('2026-08-23T14:00:00Z'), status: AttendanceIntervalStatus.ACTIVE }],
  },
  {
    id: 'sample-2', date: new Date('2026-08-24T00:00:00Z'), personnelId: 'person-1', employeeId: null,
    securityPersonnelId: null, personnelFirstName: 'آریا', personnelLastName: 'متانت', intervals: [],
  },
], options);
async function main() {
  const pdf = await renderPersonnelAttendanceReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 20_000);
  if (process.env.REPORT_PDF_QA_PATH) fs.writeFileSync(process.env.REPORT_PDF_QA_PATH, pdf);
  console.log('personnel attendance PDF smoke test passed');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
