import fs from 'fs';
import path from 'path';
import { generatePdfBufferFromHtml } from '../utils/pdf';
import { PersonnelAttendanceDay, PersonnelAttendancePerson } from './personnelAttendanceReport';

type Report = ReturnType<typeof import('./personnelAttendanceReport').buildPersonnelAttendanceReport>;
const faDigits = (value: string | number) => String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const minutesLabel = (value: number) => faDigits(`${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`);
const jalaliFormatter = new Intl.DateTimeFormat('en-US-u-ca-persian', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayFormatter = new Intl.DateTimeFormat('fa-IR', { timeZone: 'UTC', weekday: 'long' });
const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const jalali = (key: string) => {
  const parts = Object.fromEntries(jalaliFormatter.formatToParts(new Date(`${key}T12:00:00.000Z`)).map((part) => [part.type, part.value]));
  return faDigits(`${parts.year}/${parts.month}/${parts.day}`);
};
const clock = (iso: string) => faDigits(clockFormatter.format(new Date(iso)));
const font = (name: string) => fs.readFileSync(path.join(__dirname, '../../public/yekan-bakh', name)).toString('base64');

const styles = () => `<style>
@font-face{font-family:Yekan;src:url(data:font/woff2;base64,${font('YekanBakh-Regular.woff2')}) format('woff2');font-weight:400}
@font-face{font-family:Yekan;src:url(data:font/woff2;base64,${font('YekanBakh-SemiBold.woff2')}) format('woff2');font-weight:600}
@font-face{font-family:Yekan;src:url(data:font/woff2;base64,${font('YekanBakh-Bold.woff2')}) format('woff2');font-weight:700}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#132426;background:white}
body{font-family:Yekan,Tahoma,sans-serif;direction:rtl;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.report-sheet{position:relative;width:210mm;height:297mm;padding:15mm 11mm;break-after:page;overflow:hidden}.report-sheet:last-child{break-after:auto}
.footer{position:absolute;right:11mm;left:11mm;bottom:6mm;display:flex;justify-content:space-between;direction:rtl;font-size:7pt;color:#30484b}
.cover{display:flex;align-items:center;justify-content:center;text-align:center}.cover-inner{width:100%;transform:translateY(-8mm)}
.dash{width:11mm;height:1.2mm;border-radius:8mm;background:#00565a;margin:0 auto 6mm}h1{font-size:24pt;line-height:1.35;margin:0;color:#102123}.cover-range{font-size:15pt;color:#486063;margin:2mm 0 10mm}
.cards{display:flex;gap:3mm;margin:0 auto 8mm;max-width:139mm}.card{flex:1;background:#f5f8f8;border:1px solid #dce6e7;border-radius:3mm;padding:4mm 2mm 3mm}.card strong{display:block;font-size:18pt;color:#00565a}.card span{display:block;color:#698083;font-size:9pt;margin-top:1.3mm}
.range{font-size:10pt;color:#51696c;line-height:1.9;margin:0 0 7mm}.notes{border-top:1px solid #dce6e7;max-width:139mm;margin:auto;padding-top:5mm;color:#60777a;font-size:8.4pt;line-height:1.75;text-align:right}.notes p{margin:0}
.person-header{display:flex;justify-content:space-between;align-items:end;gap:4mm;border-bottom:2px solid #00565a;padding-bottom:2mm}.eyebrow{color:#687f81;font-size:8.4pt}.person-title h2{margin:.5mm 0 0;font-size:20pt;line-height:1.3;color:#102123}.totals{display:flex;gap:5mm;flex:0 0 auto;direction:rtl}.total{text-align:left;min-width:31mm}.total span{display:block;font-size:8pt;color:#6c8385}.total strong{font-size:15pt;color:#00565a;line-height:1.3}
.stats{margin:2.2mm 0 2.8mm;color:#657d80;font-size:8.4pt}.dot{padding:0 1.6mm;color:#a8b9ba}table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%;border:1px solid #c5d4d6;border-radius:2.3mm;overflow:hidden;font-size:8.9pt}
col.date{width:18%}col.day{width:12%}col.entry{width:18%}col.exit{width:18%}col.gross{width:13%}col.net{width:21%}th{background:#edf4f4;color:#496063;font-weight:600;height:7.4mm;border-bottom:1px solid #c5d4d6;white-space:nowrap;font-size:8.4pt}
td{height:6.8mm;text-align:center;border-bottom:1px solid #d8e2e3;padding:.4mm 1mm;line-height:1.18;vertical-align:middle}tbody tr:nth-child(even){background:#f8fafb}tbody tr:last-child td{border-bottom:0}td.work{color:#00565a;font-weight:700}.absent{color:#b5372c;font-weight:600}.muted{color:#879a9d}.clock{direction:ltr;display:inline-block;unicode-bidi:isolate}.clock+.clock{display:block;margin-top:.2mm}
</style>`;

const footer = (page: number, total: number) => `<footer class="footer"><span>سنگ سبلان · گزارش حضور و غیاب</span><span dir="ltr">${page} / ${total}</span></footer>`;
const labelForRange = (report: Report) => {
  const start = jalali(report.startDate);
  const end = jalali(report.endDate);
  return start === end ? start : `${start} تا ${end}`;
};

function cover(report: Report, totalPages: number) {
  return `<section class="report-sheet cover"><div class="cover-inner"><div class="dash"></div><h1>گزارش حضور و غیاب پرسنل</h1><div class="cover-range">${labelForRange(report)}</div>
  <div class="cards"><div class="card"><strong>${faDigits(report.people.length)}</strong><span>نام پرسنلی</span></div><div class="card"><strong>${faDigits(report.records)}</strong><span>روز ثبت‌شده</span></div><div class="card"><strong>${faDigits(report.validIntervals)}</strong><span>بازه معتبر تردد</span></div></div>
  <p class="range">بازه گزارش: ${labelForRange(report)}<br>معادل: ${faDigits(report.startDate.replace(/-/g, '/'))} تا ${faDigits(report.endDate.replace(/-/g, '/'))}</p>
  <div class="notes"><p>زمان‌های ورود و خروج از رکوردهای ثبت‌شده سامانه استخراج شده‌اند.</p><p>کارکرد بدون زمان استراحت برای هر روز برابر کارکرد آن روز منهای ${faDigits(report.restMinutes)} دقیقه است؛ نتیجه کمتر از صفر، صفر نمایش داده می‌شود.</p><p>${faDigits(report.voidedIntervals)} بازه باطل‌شده در محاسبه وارد نشده‌اند.${report.openIntervals ? ` ${faDigits(report.openIntervals)} بازه بدون زمان خروج هنوز در کارکرد محاسبه نشده‌اند.` : ''}</p><p>تأخیر و اضافه‌کاری در این گزارش محاسبه نشده است.</p>${report.mergeMatchingNames ? '<p>شناسه‌های دارای نام یکسان زیر یک نام تجمیع شده‌اند.</p>' : ''}</div></div>${footer(1, totalPages)}</section>`;
}

function detailRows(days: PersonnelAttendanceDay[]) {
  return days.map((day) => {
    const date = new Date(`${day.date}T12:00:00.000Z`);
    const times = (kind: 'enteredAt' | 'exitedAt') => day.intervals.length
      ? day.intervals.map((interval) => `<span class="clock">${interval[kind] ? clock(interval[kind]!) : '—'}</span>`).join('')
      : kind === 'enteredAt' ? '<span class="absent">بدون تردد</span>' : '<span class="muted">—</span>';
    return `<tr><td>${jalali(day.date)}</td><td>${weekdayFormatter.format(date)}</td><td>${times('enteredAt')}</td><td>${times('exitedAt')}</td><td class="work"><span class="clock">${minutesLabel(day.grossMinutes)}</span></td><td class="work"><span class="clock">${minutesLabel(day.netMinutes)}</span></td></tr>`;
  }).join('');
}

function personPage(report: Report, person: PersonnelAttendancePerson, days: PersonnelAttendanceDay[], part: number, parts: number, page: number, totalPages: number) {
  const noMovement = person.days.length - person.daysWithMovement;
  return `<section class="report-sheet"><div class="person-header"><div class="person-title"><div class="eyebrow">گزارش حضور و غیاب · ${labelForRange(report)}${parts > 1 ? ` · بخش ${faDigits(part)} از ${faDigits(parts)}` : ''}</div><h2>${escapeHtml(person.name)}</h2></div><div class="totals"><div class="total"><span>جمع کارکرد</span><strong class="clock">${minutesLabel(person.grossMinutes)}</strong></div><div class="total"><span>جمع کارکرد بدون زمان استراحت</span><strong class="clock">${minutesLabel(person.netMinutes)}</strong></div></div></div>
  <div class="stats">${faDigits(person.daysWithMovement)} روز دارای تردد${noMovement ? `<span class="dot">•</span>${faDigits(noMovement)} روز بدون تردد ثبت‌شده` : ''}<span class="dot">•</span>${faDigits(person.intervalCount)} بازه ورود و خروج</div>
  <table><colgroup><col class="date"><col class="day"><col class="entry"><col class="exit"><col class="gross"><col class="net"></colgroup><thead><tr><th>تاریخ</th><th>روز</th><th>ورود</th><th>خروج</th><th>کارکرد</th><th>کارکرد بدون زمان استراحت</th></tr></thead><tbody>${detailRows(days)}</tbody></table>${footer(page, totalPages)}</section>`;
}

export async function renderPersonnelAttendanceReportPdf(report: Report): Promise<Buffer> {
  const chunks = report.people.flatMap((person) => {
    const pages: PersonnelAttendanceDay[][] = [];
    let current: PersonnelAttendanceDay[] = [];
    let rowUnits = 0;
    for (const day of person.days) {
      const units = Math.max(1, day.intervals.length);
      if (current.length && rowUnits + units > 27) { pages.push(current); current = []; rowUnits = 0; }
      current.push(day);
      rowUnits += units;
    }
    if (current.length) pages.push(current);
    return pages.map((days, index) => ({ person, days, part: index + 1, parts: pages.length }));
  });
  const totalPages = chunks.length + 1;
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش حضور و غیاب پرسنل</title>${styles()}</head><body>${cover(report, totalPages)}${chunks.map((chunk, index) => personPage(report, chunk.person, chunk.days, chunk.part, chunk.parts, index + 2, totalPages)).join('')}</body></html>`;
  return generatePdfBufferFromHtml({ htmlContent: html, widthMm: 210, heightMm: 297, margin: { top: '0', right: '0', bottom: '0', left: '0' }, assertNoOverflowSelector: '.report-sheet' });
}
