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
  delayMinutes: number | null;
  overtimeMinutes: number | null;
  overtimePending: boolean;
  physicalPresenceMinutes?: number;
  outsideMinutes?: number;
  accountedWorkMinutes?: number | null;
  movementTimeline?: string;
}

interface RenderSecurityAttendanceReportOptions {
  baseStyles: string;
  title: string;
  totals: { absent: number; late: number };
  rows: SecurityAttendanceReportRow[];
  showDateColumn: boolean;
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const minutesLabel = (value: number | null, pending = false) => pending ? 'در انتظار ثبت خروج' : value === null ? '-' : `${value.toLocaleString('fa-IR')} دقیقه`;

export const securityAttendanceStatusLabel = (status: AttendanceStatus | string) => ({
  [AttendanceStatus.PRESENT]: 'حاضر',
  [AttendanceStatus.ABSENT]: 'غایب',
  [AttendanceStatus.LATE]: 'حاضر با تأخیر',
  [AttendanceStatus.PENDING]: 'در انتظار شروع',
  [AttendanceStatus.NON_WORKING_DAY]: 'روز غیرکاری',
  [AttendanceStatus.MISSION]: 'ماموریت',
  [AttendanceStatus.HOURLY_LEAVE]: 'مرخصی ساعتی',
  [AttendanceStatus.SICK_LEAVE]: 'مرخصی استعلاجی',
  [AttendanceStatus.VACATION]: 'مرخصی روزانه'
}[status] || String(status || '-'));

export const renderSecurityAttendanceReportHtml = ({ baseStyles, title, totals, rows, showDateColumn }: RenderSecurityAttendanceReportOptions) => {
  const columnCount = showDateColumn ? 11 : 10;
  const detailRows = rows.map((row) => `<tr>${showDateColumn ? `<td>${escapeHtml(row.date)}</td>` : ''}<td class="employee-cell">${escapeHtml(row.employee)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.entryTime)}</td><td>${escapeHtml(row.exitTime)}</td><td>${escapeHtml(minutesLabel(row.physicalPresenceMinutes ?? null))}</td><td>${escapeHtml(minutesLabel(row.outsideMinutes ?? null))}</td><td>${escapeHtml(row.accountedWorkMinutes === null || row.accountedWorkMinutes === undefined ? 'در انتظار تکمیل' : minutesLabel(row.accountedWorkMinutes))}</td><td>${escapeHtml(minutesLabel(row.delayMinutes))}</td><td>${escapeHtml(minutesLabel(row.overtimeMinutes, row.overtimePending))}</td><td class="notes-cell">${escapeHtml(row.notes)}</td></tr>`).join('');
  return `${baseStyles}<style>.cards{grid-template-columns:repeat(2,1fr)}.attendance-detail{font-size:8px}.attendance-detail thead{display:table-header-group}.attendance-detail tr{break-inside:avoid;page-break-inside:avoid}.attendance-detail th,.attendance-detail td{padding:5px 4px;vertical-align:middle}.attendance-detail .employee-cell{font-weight:700;color:#0f172a}.attendance-detail .notes-cell{white-space:pre-line;line-height:1.55}.attendance-count{margin:0 0 7px;color:#475569;font-size:9px}.minimal-header{margin-bottom:10px}</style><div class="sheet"><header class="header minimal-header"><h1>${escapeHtml(title)}</h1></header><div class="cards"><div class="card"><span>غایب</span><strong>${totals.absent.toLocaleString('fa-IR')}</strong></div><div class="card"><span>تأخیر</span><strong>${totals.late.toLocaleString('fa-IR')}</strong></div></div><p class="attendance-count">${rows.length.toLocaleString('fa-IR')} ردیف حضور و غیاب</p><table class="attendance-detail"><thead><tr>${showDateColumn ? '<th>تاریخ</th>' : ''}<th>پرسنل</th><th>وضعیت</th><th>ورود</th><th>خروج</th><th>حضور در محل</th><th>خارج از محل</th><th>کارکرد کل</th><th>تأخیر</th><th>اضافه‌کار</th><th>یادداشت و بازه‌ها</th></tr></thead><tbody>${detailRows || `<tr><td colspan="${columnCount}">در بازه انتخاب‌شده رکوردی وجود ندارد.</td></tr>`}</tbody></table></div>`;
};
