import { SecurityShiftLogStatus, SecurityShiftSessionStatus } from '@prisma/client';
import { buildCombinedSecurityShiftTimeline } from './securityShiftSessionPolicy';

type Attachment = {
  originalName: string;
  storageName?: string;
  mimeType?: string;
  dataUri?: string;
};

type RenderOptions = {
  generatedAt?: Date;
  resolveAttachmentDataUri?: (attachment: Attachment) => string;
  baseStyles?: string;
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const personName = (value: any) => `${value?.firstName || ''} ${value?.lastName || ''}`.trim() || value?.username || '—';
const dateTime = (value: unknown) => value
  ? new Date(String(value)).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })
  : '—';

const minutesBetween = (from: unknown, to: unknown) => {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(String(to)).getTime() - new Date(String(from)).getTime()) / 60_000));
};

const durationLabel = (minutes: number | null) => minutes == null
  ? '—'
  : `${Math.floor(minutes / 60).toLocaleString('fa-IR')} ساعت و ${(minutes % 60).toLocaleString('fa-IR')} دقیقه`;

const styles = `
  <style>
    @page{size:A4 landscape;margin:8mm 7mm 14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    html{background:#eef3f5}
    body{margin:0;background:#eef3f5;color:#17212b;font-family:'Yekan Bakh',Tahoma,Arial,sans-serif;direction:rtl;font-size:10px;line-height:1.65}
    .sheet{padding:1mm}
    .report-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;padding:10px 13px;border:1px solid #dce5e8;border-radius:12px;background:#f7fafb;box-shadow:3px 3px 8px rgba(110,128,142,.13),-3px -3px 8px rgba(255,255,255,.9)}
    .brand{display:flex;align-items:center;gap:9px}.brand-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:#e5f5f1;color:#087864;font-size:19px;font-weight:700;box-shadow:2px 2px 5px rgba(110,128,142,.14),-2px -2px 5px #fff}
    h1,h2,h3,p{margin:0}h1{font-size:17px;color:#111820}h2{font-size:14px;color:#111820}h3{margin:10px 0 5px;font-size:11px;color:#26323d}
    .meta,.muted{color:#64717d}.meta{margin-top:2px;font-size:9px}
    .shift{padding:10px;border:1px solid #dce5e8;border-radius:12px;background:#f7fafb;box-shadow:3px 3px 9px rgba(110,128,142,.13),-3px -3px 9px rgba(255,255,255,.92);break-inside:auto}
    .shift+.shift{break-before:page}
    .shift-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px;padding-bottom:7px;border-bottom:1px solid #e1e8eb}
    .badges{display:flex;flex-wrap:wrap;gap:5px}.badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border:1px solid #cfdadd;border-radius:999px;background:#edf2f3;color:#36444f;font-size:8.5px;font-weight:700}.badge.force,.badge.voided{border-color:#e1b8b8;background:#f9e8e8;color:#842828}.badge.active{border-color:#b8d8cf;background:#e6f4f0;color:#176653}.badge.warning{border-color:#e5cf9a;background:#f8f0db;color:#74510a}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:8px 0}.card{min-height:56px;padding:7px 9px;border:1px solid #dfe7ea;border-radius:10px;background:#f3f7f8;box-shadow:2px 2px 5px rgba(110,128,142,.1),-2px -2px 5px #fff}.card span{display:block;color:#71808d;font-size:8.5px}.card strong{display:block;margin-top:3px;color:#17212b;font-size:12px;word-break:break-word}
    table{width:100%;margin:0 0 8px;border-collapse:separate;border-spacing:0;table-layout:fixed;overflow:hidden;border:1px solid #cfdadd;border-radius:8px;background:#fff}th,td{padding:5px 6px;border-left:1px solid #d9e1e4;border-bottom:1px solid #d9e1e4;vertical-align:top;text-align:right;word-break:break-word}tr:last-child>th,tr:last-child>td{border-bottom:0}th:last-child,td:last-child{border-left:0}th{background:#eaf2f1;color:#26343d;font-weight:700}thead th{background:#e2eeec;color:#173f3a}.summary-table th{width:13%}.summary-table td{width:37%}
    .note{margin:6px 0;padding:7px 9px;border:1px solid #dbe4e7;border-right:3px solid #5d817b;border-radius:8px;background:#f1f5f6}.note.danger{border-right-color:#a84949}.section{break-inside:auto}.section-title{display:flex;align-items:center;gap:6px;margin:9px 0 5px}.section-title:before{content:'';display:block;width:4px;height:14px;border-radius:4px;background:#5d817b}
    .images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:7px 0}.evidence-image{margin:0;padding:6px;border:1px solid #d6e0e3;border-radius:9px;background:#fff;box-shadow:2px 2px 5px rgba(110,128,142,.1);break-inside:avoid}.evidence-image img{display:block;width:100%;height:auto;max-height:88mm;object-fit:contain;border-radius:6px;background:#f5f7f8}.caption{margin-top:5px;color:#566572;font-size:8.5px;direction:rtl}
    .empty{padding:9px;border:1px dashed #cbd6da;border-radius:8px;color:#71808d;text-align:center}
  </style>
`;

const evidenceHtml = (entry: any, resolveAttachmentDataUri?: RenderOptions['resolveAttachmentDataUri']) => {
  const images = (entry.attachments || []).map((attachment: Attachment) => ({
    attachment,
    dataUri: attachment.dataUri || resolveAttachmentDataUri?.(attachment) || '',
  })).filter((item: any) => item.dataUri);
  if (!images.length) return '';
  return `<div class="images">${images.map(({ attachment, dataUri }: any) => `
    <figure class="evidence-image">
      <img src="${dataUri}" alt="${escapeHtml(attachment.originalName)}" />
      <figcaption class="caption">ردیف ${Number(entry.rowNumber || 0).toLocaleString('fa-IR')} · ${escapeHtml(attachment.originalName)}</figcaption>
    </figure>
  `).join('')}</div>`;
};

const renderShift = (slot: any, options: RenderOptions) => {
  const session = slot.session;
  if (!session) return '';
  const forceClosed = session.status === SecurityShiftSessionStatus.FORCE_CLOSED;
  const corrections = session.corrections || [];
  const logEntries = session.logEntries || [];
  const patrolSessions = session.patrolSessions || [];
  const timeline = buildCombinedSecurityShiftTimeline({
    logEntries,
    patrolSessions,
    defaultAuthor: personName(session.personnel?.user),
  });
  const logEntriesById = new Map(logEntries.map((entry: any) => [entry.id, entry]));
  const actualMinutes = minutesBetween(session.startedAt, session.endedAt);
  const temporaryNames = (slot.temporaryCoverage || []).map((coverage: any) => personName(coverage.personnel?.user)).filter(Boolean);

  const correctionRows = corrections.map((correction: any) => `<tr><td>${dateTime(correction.correctedAt)}<div class="muted">${escapeHtml(correction.correctedByName)}</div></td><td>${dateTime(correction.previousStartedAt)} تا ${dateTime(correction.previousEndedAt)}</td><td>${dateTime(correction.effectiveStartedAt)} تا ${dateTime(correction.effectiveEndedAt)}</td><td>${escapeHtml(correction.reason)}</td></tr>`).join('');
  const attendanceRows = (slot.attendance || []).map((attendance: any) => `<tr><td>${escapeHtml(personName(attendance.personnel?.user))}</td><td>${dateTime(attendance.arrivedAt)}</td><td>${Number(attendance.delayMinutes || 0).toLocaleString('fa-IR')} دقیقه</td><td>${attendance.correctedAt ? `${dateTime(attendance.correctedAt)}${attendance.correctionReason ? `<div class="muted">${escapeHtml(attendance.correctionReason)}</div>` : ''}` : '—'}</td></tr>`).join('');
  const timelineRows = timeline.map((event: any) => {
    const entry = event.kind === 'SHIFT_LOG' ? logEntriesById.get(event.id) as any : null;
    const people = event.kind === 'SHIFT_LOG' ? (event.participants || []).join('، ') || event.author || '—' : event.author || '—';
    const status = event.kind === 'SHIFT_LOG'
      ? event.status === SecurityShiftLogStatus.VOIDED
        ? `<span class="badge voided">باطل‌شده</span>${event.voidReason ? `<div class="muted">${escapeHtml(event.voidReason)}</div>` : ''}`
        : '<span class="badge active">فعال</span>'
      : `<span class="badge">${event.kind === 'PATROL_START' ? 'شروع گشت' : 'پایان گشت'}</span>`;
    return `<tr><td>${event.rowNumber != null ? `ردیف ${event.rowNumber.toLocaleString('fa-IR')} · ` : ''}${escapeHtml(event.title)}${event.typeDescription ? `<div class="muted">${escapeHtml(event.typeDescription)}</div>` : ''}</td><td>${escapeHtml(people)}</td><td>${escapeHtml(event.description || '—')}</td><td>${status}</td><td>${dateTime(event.createdAt)}</td></tr>${entry ? `<tr><td colspan="5">${evidenceHtml(entry, options.resolveAttachmentDataUri)}</td></tr>` : ''}`;
  }).join('');

  return `<section class="shift">
    <div class="shift-title"><div><h2>${escapeHtml(slot.plan?.title || 'شیفت گارد')}</h2><p class="meta">${dateTime(slot.startsAt)} تا ${dateTime(slot.endsAt)}</p></div><div class="badges"><span class="badge ${forceClosed ? 'force' : 'active'}">${forceClosed ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'}</span>${corrections.length ? '<span class="badge warning">اصلاح‌شده</span>' : ''}</div></div>
    <div class="cards"><div class="card"><span>نیروی مؤثر</span><strong>${escapeHtml(personName(session.personnel?.user))}</strong></div><div class="card"><span>مدت واقعی</span><strong>${durationLabel(actualMinutes)}</strong></div><div class="card"><span>حضور ثبت‌شده</span><strong>${(slot.attendance || []).length.toLocaleString('fa-IR')} نفر</strong></div><div class="card"><span>رویداد عملیاتی</span><strong>${timeline.length.toLocaleString('fa-IR')} مورد</strong></div></div>
    <table class="summary-table"><tbody><tr><th>بازه برنامه</th><td>${dateTime(slot.startsAt)} تا ${dateTime(slot.endsAt)}</td><th>بازه واقعی</th><td>${dateTime(session.startedAt)} تا ${dateTime(session.endedAt)}</td></tr><tr><th>شیفت</th><td>${escapeHtml(slot.plannedPersonnel?.shift?.namePersian || '—')}</td><th>نیروی برنامه‌ریزی‌شده</th><td>${escapeHtml(personName(slot.plannedPersonnel?.user))}</td></tr>${slot.replacementPersonnel ? `<tr><th>جانشین</th><td>${escapeHtml(personName(slot.replacementPersonnel.user))}</td><th>پوشش موقت</th><td>${escapeHtml(temporaryNames.join('، ') || '—')}</td></tr>` : temporaryNames.length ? `<tr><th>پوشش موقت</th><td colspan="3">${escapeHtml(temporaryNames.join('، '))}</td></tr>` : ''}</tbody></table>
    ${session.forceCloseReason ? `<div class="note danger"><strong>دلیل بستن توسط مدیر:</strong> ${escapeHtml(session.forceCloseReason)}</div>` : ''}
    ${session.closureSummary ? `<div class="note"><strong>خلاصه پایان:</strong> ${escapeHtml(session.closureSummary)}</div>` : ''}
    ${correctionRows ? `<div class="section"><h3 class="section-title">تاریخچه اصلاح زمان‌ها</h3><table><thead><tr><th>اصلاح</th><th>زمان قبلی</th><th>زمان مؤثر</th><th>دلیل</th></tr></thead><tbody>${correctionRows}</tbody></table></div>` : ''}
    <div class="section"><h3 class="section-title">حضور و پوشش</h3>${attendanceRows ? `<table><thead><tr><th>نیرو</th><th>زمان حضور</th><th>تأخیر</th><th>اصلاح ثبت</th></tr></thead><tbody>${attendanceRows}</tbody></table>` : '<div class="empty">حضور ثبت‌شده‌ای برای این شیفت وجود ندارد.</div>'}</div>
    <div class="section"><h3 class="section-title">خط زمانی شیفت</h3>${timelineRows ? `<table><thead><tr><th>رویداد</th><th>نیرو / افراد مرتبط</th><th>شرح</th><th>وضعیت</th><th>زمان</th></tr></thead><tbody>${timelineRows}</tbody></table>` : '<div class="empty">رویداد عملیاتی ثبت نشده است.</div>'}</div>
  </section>`;
};

export const renderCompletedSecurityShiftPdfHtml = (slots: any[], options: RenderOptions = {}) => {
  const generatedAt = options.generatedAt || new Date();
  return `${options.baseStyles || ''}${styles}<div class="sheet"><header class="report-header"><div class="brand"><div class="brand-mark">S</div><div><h1>گزارش شیفت‌های گارد</h1><p class="meta">${slots.length.toLocaleString('fa-IR')} شیفت انتخاب‌شده</p></div></div><div class="meta">زمان تولید: ${dateTime(generatedAt)}</div></header>${slots.map((slot) => renderShift(slot, options)).join('')}</div>`;
};
