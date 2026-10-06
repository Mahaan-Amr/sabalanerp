import type { Report, ReportRow } from '../services/partnerSales/reporting/contracts';
import { generatePdfBufferFromHtml } from './pdf';
import { renderYekanFontFaces } from './printTemplate';

const escape = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const money = (value: string | null | undefined) => value == null ? '—' : escape(value.replace(/^[+-]?\d+/, integer => integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]));
const states: Record<string, string> = { DRAFT: 'یادداشت', AWAITING_CUSTOMER_CONFIRMATION: 'در انتظار تأیید مشتری', CUSTOMER_APPROVED: 'تأیید مشتری', COMMITTED: 'قطعی', CANCELLED: 'لغو شده', VOIDED: 'لغو شده' };
const collections = { UNPAID: 'وصول نشده', PARTIAL: 'وصول جزئی', SETTLED: 'تسویه مشتری', OVERPAID: 'بیش پرداخت' };
const rowStatus = (row: ReportRow) => ['CANCELLED', 'VOIDED'].includes(row.state) ? 'لغو شده' : row.collectionStatus ? collections[row.collectionStatus] : states[row.state] || row.state;
const currency = (value: string) => value === 'IRT' ? 'تومان' : 'ریال';

/** Render only the already authorized frozen export; never query current balances here. */
export function renderPartnerReportHtml(report: Report): string {
  const table = (headers: string[], rows: string[][]) => `<table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const summaries = report.totals.map(total => `<h2>جمع گزارش · ${currency(total.currency)}</h2>${table(['فروش به مشتری', 'دریافتی مشتری', 'خرید از سبلان', 'سود خالص قابل مقایسه', 'مانده حسابداری'], [[money(total.metrics.retailSales), money(total.metrics.retailCollected), money(total.metrics.wholesalePurchases), money(total.metrics.netComparableMargin), total.accountingCovered === total.accountingEligible && total.accountingEligible > 0 ? money(total.accountingBalance) : 'پوشش حسابداری کامل نیست']])}`).join('');
  const rows = report.rows.map(row => [escape(Number.isSafeInteger(row.trackingNumber) ? `همکار-${String(row.trackingNumber).padStart(5, '0')}` : row.caseNumber), escape(row.customerContractNumber), escape(states[row.state] || row.state), escape(rowStatus(row)), escape(row.currency ? currency(row.currency) : '—'), money(row.metrics?.retailSales), money(row.metrics?.retailCollected), money(row.metrics?.wholesalePurchases), money(row.metrics?.netComparableMargin)]);
  const monthly = report.series.map(series => `<h2>روند ماهانه · ${currency(series.currency)}</h2>${table(['ماه', 'بدهی به سبلان', 'مطالبات مشتری', 'دریافتی مشتری'], series.points.map(point => [escape(point.jalaliMonth), money(point.debtBalance), money(point.receivableBalance), money(point.receipts)]))}`).join('');
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>${renderYekanFontFaces()}
  body{font-family:'Yekan Bakh',sans-serif;color:#173139;font-size:10px;direction:rtl;margin:0}h1{font-size:24px;margin:0 0 10px}h2{font-size:15px;margin:22px 0 8px}header{border-bottom:2px solid #087c70;padding-bottom:14px}p{margin:6px 0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #d1dce0;padding:8px 5px;text-align:right;overflow-wrap:anywhere;vertical-align:top}th{background:#e7f1f0;font-weight:700}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:16px;color:#53676d;font-size:9px}</style></head><body>
  <header><h1>گزارش و حساب من با سبلان</h1><p>بازه: ${escape(report.scope.from)} تا ${escape(report.scope.to)} · مؤثر تا ${escape(report.scope.effectiveThrough)}</p><p>جستجو: ${escape(report.scope.search || 'همه پرونده‌ها')} · وضعیت: ${escape(report.scope.state ? states[report.scope.state] || report.scope.state : 'همه وضعیت‌ها')}</p><p>زمان تهیه: ${escape(new Date(report.capturedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }))} · تعداد پرونده‌ها: ${report.count.toLocaleString('fa-IR')}</p></header>
  ${summaries}<h2>جزئیات پرونده‌ها</h2>${rows.length ? table(['پرونده', 'قرارداد مشتری', 'وضعیت قرارداد', 'وضعیت وصول', 'واحد پول', 'فروش', 'وصول مشتری', 'خرید سبلان', 'سود خالص'], rows) : '<p>پرونده‌ای در این محدوده وجود ندارد.</p>'}${monthly}<footer>مبالغ و وضعیت‌ها مربوط به زمان تهیه این گزارش هستند. سوابق لغوشده برای پیگیری حفظ شده‌اند.</footer></body></html>`;
}

export function generatePartnerReportPdf(report: Report): Promise<Buffer> {
  return generatePdfBufferFromHtml({ htmlContent: renderPartnerReportHtml(report), landscape: true,
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' } });
}
