type PdfInput = {
  personnel: any;
  exporterName: string;
  generatedAt: Date;
  filters: Record<string, unknown>;
  reports: any[];
  includeImages: boolean;
};

export const prepareSecurityPersonnelReportPdfEvidence = (
  reports: any[],
  entries: any[],
  includeImages: boolean,
  readAttachment: (storageName: string, mimeType: string) => string,
) => reports.map((report, index) => ({
  ...report,
  attachments: report.attachments.map((attachment: any) => {
    const source = entries[index]?.attachments.find((item: any) => item.id === attachment.id);
    if (!source) throw new Error(`Attachment metadata is missing for ${attachment.originalName}.`);
    const dataUri = includeImages ? readAttachment(source.storageName, source.mimeType) : '';
    if (includeImages && !dataUri) throw new Error(`Attachment file is missing for ${source.originalName}.`);
    return { ...attachment, dataUri };
  }),
}));

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const name = (value: any) => `${value?.firstName || ''} ${value?.lastName || ''}`.trim() || '—';
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : '—';
const statusLabel = (value: string) => value === 'VOIDED' ? 'باطل‌شده' : 'فعال';
const sessionLabel = (value: string) => ({ ACTIVE: 'فعال', CLOSED: 'بسته‌شده', FORCE_CLOSED: 'بسته‌شده توسط مدیر' }[value] || value || '—');

export const renderSecurityPersonnelReportHistoryPdfHtml = (input: PdfInput) => {
  const personnelName = name(input.personnel);
  const filterNames: Record<string, string> = { q: 'جستجو', status: 'وضعیت', startDate: 'از تاریخ', endDate: 'تا تاریخ', categoryId: 'دسته‌بندی', reportTypeId: 'نوع گزارش', reporterId: 'گزارش‌دهنده', attachments: 'تصاویر' };
  const filterValues: Record<string, string> = { ACTIVE: 'فعال', VOIDED: 'باطل‌شده', with: 'دارای تصویر', without: 'بدون تصویر' };
  const filterLabels = Object.entries(input.filters)
    .filter(([key, value]) => filterNames[key] && value && value !== 'all')
    .map(([key, value]) => `${filterNames[key]}: ${filterValues[String(value)] || value}`)
    .join(' · ') || 'وضعیت فعال، بدون محدودیت دیگر';
  const reports = input.reports.map((report) => {
    const attachments = report.attachments || [];
    const attachmentNames = attachments.map((item: any) => escapeHtml(item.originalName)).join('، ') || '—';
    const images = input.includeImages && attachments.length
      ? `<div class="images">${attachments.map((item: any) => `<figure><img src="${escapeHtml(item.dataUri)}" alt="${escapeHtml(item.originalName)}"/><figcaption>${escapeHtml(item.originalName)}</figcaption></figure>`).join('')}</div>`
      : '';
    const voided = report.status === 'VOIDED'
      ? `<div class="void-note"><strong>ابطال:</strong> ${dateTime(report.voidedAt)} · ${escapeHtml(report.voidedByName || '—')}<br/>${escapeHtml(report.voidReason || '—')}</div>`
      : '';
    return `<section class="report"${input.includeImages ? ' style="break-inside:auto"' : ''}>
      <header><div><h2>ردیف ${Number(report.rowNumber || 0).toLocaleString('fa-IR')} · ${escapeHtml(report.categoryNameSnapshot)}${report.reportTypeNameSnapshot ? ` / ${escapeHtml(report.reportTypeNameSnapshot)}` : ''}</h2><p>${dateTime(report.createdAt)} · گزارش‌دهنده: ${escapeHtml(report.reporterName)}</p></div><span class="badge ${report.status === 'VOIDED' ? 'voided' : ''}">${statusLabel(report.status)}</span></header>
      <div class="description">${escapeHtml(report.description || 'بدون شرح')}</div>
      <dl><div><dt>افراد مرتبط</dt><dd>${escapeHtml((report.participants || []).map((item: any) => item.name).join('، ') || '—')}</dd></div><div><dt>شناسه گزارش</dt><dd>${escapeHtml(report.id)}</dd></div><div><dt>بازه برنامه</dt><dd>${dateTime(report.session?.slot?.startsAt)} تا ${dateTime(report.session?.slot?.endsAt)}</dd></div><div><dt>بازه واقعی</dt><dd>${dateTime(report.session?.startedAt)} تا ${dateTime(report.session?.endedAt)} · ${escapeHtml(sessionLabel(report.session?.status))}</dd></div><div><dt>پیوست‌ها</dt><dd>${attachments.length.toLocaleString('fa-IR')} تصویر · ${attachmentNames}</dd></div></dl>
      ${voided}${images}
    </section>`;
  }).join('');
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><style>
    @page{size:A4 landscape;margin:10mm 9mm 16mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact}body{margin:0;color:#17212b;background:#fff;font-family:'Yekan Bakh',Tahoma,Arial,sans-serif;font-size:10px;line-height:1.65}.top{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #dbe4e7;border-radius:12px;background:#f5f8f8}.top h1,h2,p{margin:0}.top h1{font-size:18px}.meta{color:#64717d}.identity{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:9px 0}.identity div,.report{border:1px solid #dbe4e7;border-radius:10px;background:#fff}.identity div{padding:7px}.identity span,dt{display:block;color:#71808d;font-size:8.5px}.report{padding:9px;margin:8px 0;break-inside:avoid}.report>header{display:flex;justify-content:space-between;gap:10px;padding-bottom:7px;border-bottom:1px solid #e1e8eb}.report h2{font-size:12px}.badge{align-self:flex-start;padding:3px 9px;border-radius:999px;background:#e6f4f0;color:#176653;font-weight:700}.badge.voided{background:#f9e8e8;color:#842828}.description{padding:9px 0;font-size:11px;white-space:pre-wrap}dl{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin:0}dl div{padding:5px 7px;background:#f5f8f8;border-radius:7px}dd{margin:1px 0 0;word-break:break-word}.void-note{margin-top:7px;padding:7px;border-right:3px solid #a84949;background:#fdf2f2}.images{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px}.images figure{margin:0;padding:6px;border:1px solid #dbe4e7;border-radius:8px;break-inside:avoid}.images img{display:block;width:100%;max-height:82mm;object-fit:contain}.images figcaption{margin-top:4px;color:#64717d}.omitted{margin:8px 0;padding:7px;border:1px dashed #cbd6da;border-radius:8px;color:#64717d}
  </style></head><body><header class="top"><div><h1>سوابق گزارش‌های گارد — ${escapeHtml(personnelName)}</h1><p class="meta">${input.reports.length.toLocaleString('fa-IR')} گزارش · زمان تولید: ${dateTime(input.generatedAt)}</p></div><div class="meta">تهیه‌کننده: ${escapeHtml(input.exporterName)}<br/>فیلترها: ${escapeHtml(filterLabels)}</div></header><div class="identity"><div><span>پرسنل</span><strong>${escapeHtml(personnelName)}</strong></div><div><span>شماره پرسنلی</span><strong>${escapeHtml(input.personnel.employeeNumber || '—')}</strong></div><div><span>کد ملی</span><strong>${escapeHtml(input.personnel.nationalCode || '—')}</strong></div><div><span>واحد</span><strong>${escapeHtml(input.personnel.department?.namePersian || input.personnel.department?.name || '—')}</strong></div></div>${input.includeImages ? '' : '<div class="omitted">تصاویر در این خروجی درج نشده‌اند؛ نام و تعداد پیوست‌ها برای هر گزارش حفظ شده است.</div>'}${reports}</body></html>`;
};
