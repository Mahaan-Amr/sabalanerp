import { AttendanceStatus } from '@prisma/client';

export interface SecurityAttendanceReportRow {
  date: string;
  employee: string;
  department: string;
  status: string;
  entryTime: string;
  exitTime: string;
  shift: string;
  notes: string;
  signature: string;
}

interface SecurityAttendanceReportTotals {
  total: number;
  present: number;
  absent: number;
  late: number;
}

interface RenderSecurityAttendanceReportOptions {
  baseStyles: string;
  title: string;
  generatedAt: string;
  totals: SecurityAttendanceReportTotals;
  rows: SecurityAttendanceReportRow[];
}

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const securityAttendanceStatusLabel = (status: AttendanceStatus | string) => ({
  [AttendanceStatus.PRESENT]: 'حاضر',
  [AttendanceStatus.ABSENT]: 'غایب',
  [AttendanceStatus.LATE]: 'تأخیر',
  [AttendanceStatus.MISSION]: 'ماموریت',
  [AttendanceStatus.HOURLY_LEAVE]: 'مرخصی ساعتی',
  [AttendanceStatus.SICK_LEAVE]: 'مرخصی استعلاجی',
  [AttendanceStatus.VACATION]: 'مرخصی روزانه'
}[status] || String(status || '-'));

export const renderSecurityAttendanceReportHtml = ({
  baseStyles,
  title,
  generatedAt,
  totals,
  rows
}: RenderSecurityAttendanceReportOptions) => {
  const detailRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td class="employee-cell">${escapeHtml(row.employee)}</td>
      <td>${escapeHtml(row.department)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.entryTime)}</td>
      <td>${escapeHtml(row.exitTime)}</td>
      <td>${escapeHtml(row.shift)}</td>
      <td class="notes-cell">${escapeHtml(row.notes)}</td>
      <td>${escapeHtml(row.signature)}</td>
    </tr>
  `).join('');

  return `
    ${baseStyles}
    <style>
      .attendance-detail{font-size:8.25px}
      .attendance-detail thead{display:table-header-group}
      .attendance-detail tr{break-inside:avoid;page-break-inside:avoid}
      .attendance-detail th,.attendance-detail td{padding:3px 4px;vertical-align:middle}
      .attendance-detail .employee-cell{font-weight:700;color:#0f172a}
      .attendance-detail .notes-cell{white-space:pre-line;line-height:1.55}
      .attendance-count{margin:0 0 6px;color:#475569;font-size:9px}
    </style>
    <div class="sheet">
      <header class="header">
        <div><h1>${escapeHtml(title)}</h1><div class="meta">زمان تولید: ${escapeHtml(generatedAt)}</div></div>
        <div class="meta">خروجی تفصیلی حضور و غیاب کارکنان</div>
      </header>
      <div class="cards">
        <div class="card"><span>کل نفر-روز</span><strong>${totals.total.toLocaleString('fa-IR')}</strong></div>
        <div class="card"><span>حاضر</span><strong>${totals.present.toLocaleString('fa-IR')}</strong></div>
        <div class="card"><span>غایب</span><strong>${totals.absent.toLocaleString('fa-IR')}</strong></div>
        <div class="card"><span>تأخیر</span><strong>${totals.late.toLocaleString('fa-IR')}</strong></div>
      </div>
      <p class="attendance-count">${rows.length.toLocaleString('fa-IR')} ردیف پرسنل در بازه انتخاب‌شده</p>
      <table class="attendance-detail">
        <colgroup>
          <col style="width:10%"><col style="width:14%"><col style="width:11%"><col style="width:9%"><col style="width:8%">
          <col style="width:8%"><col style="width:10%"><col style="width:22%"><col style="width:8%">
        </colgroup>
        <thead><tr><th>تاریخ</th><th>کارمند</th><th>بخش</th><th>وضعیت</th><th>ورود</th><th>خروج</th><th>شیفت ثبت</th><th>یادداشت</th><th>امضا</th></tr></thead>
        <tbody>${detailRows || '<tr><td colspan="9">رکوردی برای بازه انتخاب‌شده وجود ندارد.</td></tr>'}</tbody>
      </table>
    </div>
  `;
};
