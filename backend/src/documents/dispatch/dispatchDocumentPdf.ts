import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

export type DispatchDocumentKind = 'WAYBILL' | 'STATEMENT' | 'STATEMENT_ADJUSTMENT';

type CommonRenderInput = {
  schemaVersion: 1;
  documentId: string;
  waybillNumber: string;
  issuedAt: string;
  customerName: string;
  projectOrDestination: string;
  vehiclePlate: string;
  templateVersion: string;
};

type QuantityLine = {
  contractItemId: string;
  productRowId: string;
  label: string;
  unit: string;
  quantity: string;
};

type MonetaryLine = QuantityLine & {
  grossAmount: string;
  allocatedDiscount: string;
  netAmount: string;
};

export type DispatchDocumentRenderData = CommonRenderInput & ({
  kind: 'WAYBILL';
  payload: {
    allocationRevisionId: string;
    contracts: Array<{
      contractId: string;
      contractNumber: string;
      lines: QuantityLine[];
    }>;
  };
} | {
  kind: 'STATEMENT';
  payload: {
    currency: string;
    contracts: Array<{
      contractId: string;
      contractNumber: string;
      lines: MonetaryLine[];
      grossAmount: string;
      allocatedDiscount: string;
      netAmount: string;
    }>;
    grossAmount: string;
    allocatedDiscount: string;
    netAmount: string;
  };
} | {
  kind: 'STATEMENT_ADJUSTMENT';
  payload: {
    sequence: number;
    originalStatementDocumentId: string;
    reason: string;
    currency: string;
    lines: Array<{
      contractId: string;
      contractItemId: string;
      productRowId: string;
      label: string;
      unit: string;
      quantityDelta: string;
      grossAmountDelta: string;
      discountDelta: string;
      netAmountDelta: string;
    }>;
    grossAmountDelta: string;
    discountDelta: string;
    netAmountDelta: string;
  };
});

export type DispatchDocumentAssets = {
  logoDataUri: string;
  fontFacesCss: string;
};

export type RenderedDispatchDocument = {
  bytes: Buffer;
  metadata: {
    documentId: string;
    kind: DispatchDocumentKind;
    mimeType: 'application/pdf';
    size: number;
    sha256: string;
    templateVersion: string;
    generatorVersion: 'chromium-pdf-v1';
  };
};

const faDigits = '۰۱۲۳۴۵۶۷۸۹';
const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const localizeDigits = (value: string): string => value.replace(/\d/g, (digit) => faDigits[Number(digit)]);

const formatExactQuantity = (value: string): string => {
  const normalized = value.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Invalid canonical quantity: ${value}`);
  const sign = normalized.startsWith('-') ? '−' : normalized.startsWith('+') ? '+' : '';
  const unsigned = normalized.replace(/^[+-]/, '');
  return `${sign}${localizeDigits(unsigned.replace('.', '٫'))}`;
};

const roundCanonicalDecimal = (value: string): bigint => {
  const normalized = value.trim();
  const match = normalized.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid canonical monetary amount: ${value}`);
  const [, sign, integer, fraction = ''] = match;
  let rounded = BigInt(integer);
  if ((fraction[0] || '0') >= '5') rounded += 1n;
  return sign === '-' ? -rounded : rounded;
};

const formatMoney = (value: string): string => {
  const rounded = roundCanonicalDecimal(value);
  const negative = rounded < 0n;
  const grouped = (negative ? -rounded : rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return `${negative ? '−' : ''}${localizeDigits(grouped)}`;
};

const formatSignedMoney = (value: string): string => {
  const formatted = formatMoney(value);
  return value.trim().startsWith('+') && !formatted.startsWith('−') ? `+${formatted}` : formatted;
};

const formatIssuedAt = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid issuedAt: ${value}`);
  return date.toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
};

const assetCandidates = (...segments: string[]) => [
  path.resolve(process.cwd(), 'public', ...segments),
  path.resolve(process.cwd(), 'backend', 'public', ...segments),
  path.resolve(process.cwd(), '..', 'backend', 'public', ...segments),
];

const readAsset = (segments: string[], mimeType: string): string => {
  const assetPath = assetCandidates(...segments).find((candidate) => fs.existsSync(candidate));
  if (!assetPath) throw new Error(`Required dispatch document asset is missing: ${segments.join('/')}`);
  return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString('base64')}`;
};

export const loadDispatchDocumentAssets = (): DispatchDocumentAssets => {
  const regular = readAsset(['yekan-bakh', 'YekanBakh-Regular.woff2'], 'font/woff2');
  const semiBold = readAsset(['yekan-bakh', 'YekanBakh-SemiBold.woff2'], 'font/woff2');
  const bold = readAsset(['yekan-bakh', 'YekanBakh-Bold.woff2'], 'font/woff2');
  return {
    logoDataUri: readAsset(['brand', 'sabalan-logo.jpg'], 'image/jpeg'),
    fontFacesCss: [
      [400, regular], [600, semiBold], [700, bold],
    ].map(([weight, uri]) => `@font-face{font-family:'Yekan Bakh';src:url('${uri}') format('woff2');font-style:normal;font-weight:${weight};font-display:block}`).join(''),
  };
};

const renderHeader = (input: DispatchDocumentRenderData, assets: DispatchDocumentAssets, title: string, number: string) => `
  <header class="document-header">
    <img class="brand-logo" src="${escapeHtml(assets.logoDataUri)}" alt="نشان رسمی سبلان" />
    <div class="title-block"><div class="brand-name">صنایع سنگ سبلان</div><h1>${title}</h1></div>
    <dl class="document-identity"><div><dt>شماره محموله</dt><dd>${escapeHtml(number)}</dd></div><div><dt>تاریخ صدور</dt><dd>${escapeHtml(formatIssuedAt(input.issuedAt))}</dd></div></dl>
  </header>
  <section class="shipment-identity">
    <div><span>مشتری</span><strong>${escapeHtml(input.customerName)}</strong></div>
    <div><span>پروژه / مقصد</span><strong>${escapeHtml(input.projectOrDestination)}</strong></div>
    <div><span>پلاک خودرو</span><strong>${escapeHtml(input.vehiclePlate)}</strong></div>
  </section>`;

const quantityColumns = '<th class="row-number">ردیف</th><th>شرح محصول</th><th class="identity-column">شناسه ردیف</th><th class="number-column">مقدار</th><th class="unit-column">واحد</th>';
const moneyColumns = `${quantityColumns}<th class="money-column">مبلغ ناخالص</th><th class="money-column">تخفیف تخصیص‌یافته</th><th class="money-column">مبلغ خالص</th>`;
const renderTableHead = (columns: string, columnCount: number, title: string, number: string) => `<thead><tr class="continuation-header"><th colspan="${columnCount}"><span>${escapeHtml(title)}</span><b>${escapeHtml(number)}</b></th></tr><tr>${columns}</tr></thead>`;

const renderWaybill = (input: Extract<DispatchDocumentRenderData, { kind: 'WAYBILL' }>, assets: DispatchDocumentAssets) => {
  let row = 0;
  const groups = input.payload.contracts.map((contract) => `<tbody>
    <tr class="contract-heading"><td colspan="5">قرارداد ${escapeHtml(contract.contractNumber)}</td></tr>
    ${contract.lines.map((line) => `<tr><td>${localizeDigits(String(++row))}</td><td>${escapeHtml(line.label)}</td><td class="identity-value">${escapeHtml(line.productRowId)}</td><td class="numeric">${escapeHtml(formatExactQuantity(line.quantity))}</td><td>${escapeHtml(line.unit)}</td></tr>`).join('')}
  </tbody>`).join('');
  return `${renderHeader(input, assets, 'بارنامه خروج محموله', input.waybillNumber)}<table>${renderTableHead(quantityColumns, 5, 'بارنامه خروج محموله', input.waybillNumber)}${groups}</table>`;
};

const renderStatement = (input: Extract<DispatchDocumentRenderData, { kind: 'STATEMENT' }>, assets: DispatchDocumentAssets) => {
  let row = 0;
  const groups = input.payload.contracts.map((contract) => `<tbody>
    <tr class="contract-heading"><td colspan="8">قرارداد ${escapeHtml(contract.contractNumber)}</td></tr>
    ${contract.lines.map((line) => `<tr><td>${localizeDigits(String(++row))}</td><td>${escapeHtml(line.label)}</td><td class="identity-value">${escapeHtml(line.productRowId)}</td><td class="numeric">${escapeHtml(formatExactQuantity(line.quantity))}</td><td>${escapeHtml(line.unit)}</td><td class="numeric">${formatMoney(line.grossAmount)}</td><td class="numeric">${formatMoney(line.allocatedDiscount)}</td><td class="numeric strong">${formatMoney(line.netAmount)}</td></tr>`).join('')}
    <tr class="contract-subtotal"><td colspan="5">جمع قرارداد</td><td class="numeric">${formatMoney(contract.grossAmount)}</td><td class="numeric">${formatMoney(contract.allocatedDiscount)}</td><td class="numeric strong">${formatMoney(contract.netAmount)}</td></tr>
  </tbody>`).join('');
  return `${renderHeader(input, assets, 'صورت‌حساب محموله مشتری', input.waybillNumber)}<table>${renderTableHead(moneyColumns, 8, 'صورت‌حساب محموله مشتری', input.waybillNumber)}${groups}</table>
    <section class="grand-total"><span>جمع کل محموله</span><div><small>ناخالص</small><strong>${formatMoney(input.payload.grossAmount)}</strong></div><div><small>تخفیف</small><strong>${formatMoney(input.payload.allocatedDiscount)}</strong></div><div class="net"><small>خالص (${escapeHtml(input.payload.currency)})</small><strong>${formatMoney(input.payload.netAmount)}</strong></div></section>`;
};

const renderAdjustment = (input: Extract<DispatchDocumentRenderData, { kind: 'STATEMENT_ADJUSTMENT' }>, assets: DispatchDocumentAssets) => {
  const number = `${input.waybillNumber} / اصلاحیه ${localizeDigits(String(input.payload.sequence))}`;
  const rows = input.payload.lines.map((line, index) => `<tr><td>${localizeDigits(String(index + 1))}</td><td>${escapeHtml(line.label)}</td><td class="identity-value">${escapeHtml(line.productRowId)}</td><td class="numeric">${escapeHtml(formatExactQuantity(line.quantityDelta))}</td><td>${escapeHtml(line.unit)}</td><td class="numeric">${formatSignedMoney(line.grossAmountDelta)}</td><td class="numeric">${formatSignedMoney(line.discountDelta)}</td><td class="numeric strong">${formatSignedMoney(line.netAmountDelta)}</td></tr>`).join('');
  return `${renderHeader(input, assets, 'اصلاحیه صورت‌حساب محموله', number)}<div class="adjustment-reason"><span>علت اصلاح</span><strong>${escapeHtml(input.payload.reason)}</strong></div><table>${renderTableHead(moneyColumns.replace('مقدار', 'تغییر مقدار').replace('مبلغ ناخالص', 'تغییر ناخالص').replace('تخفیف تخصیص‌یافته', 'تغییر تخفیف').replace('مبلغ خالص', 'تغییر خالص'), 8, 'اصلاحیه صورت‌حساب محموله', number)}<tbody>${rows}</tbody></table>
    <section class="grand-total adjustment-total"><span>جمع خالص اصلاحیه</span><div><small>تغییر ناخالص</small><strong>${formatSignedMoney(input.payload.grossAmountDelta)}</strong></div><div><small>تغییر تخفیف</small><strong>${formatSignedMoney(input.payload.discountDelta)}</strong></div><div class="net"><small>تغییر خالص (${escapeHtml(input.payload.currency)})</small><strong>${formatSignedMoney(input.payload.netAmountDelta)}</strong></div></section>`;
};

export const renderDispatchDocumentHtml = (
  input: DispatchDocumentRenderData,
  assets: DispatchDocumentAssets = loadDispatchDocumentAssets(),
): string => {
  if (input.schemaVersion !== 1) throw new Error(`Unsupported dispatch render schema version: ${input.schemaVersion}`);
  const body = input.kind === 'WAYBILL'
    ? renderWaybill(input, assets)
    : input.kind === 'STATEMENT'
      ? renderStatement(input, assets)
      : renderAdjustment(input, assets);
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>${assets.fontFacesCss}
    @page{size:A4 portrait;margin:9mm 9mm 11mm}*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0;background:#fff;color:#17212b;font-family:'Yekan Bakh',Tahoma,Arial,sans-serif;font-size:9.4px;line-height:1.5}body{width:100%}.document-header{display:grid;grid-template-columns:22mm 1fr 54mm;align-items:center;gap:4mm;border-bottom:2px solid #176653;padding:0 0 4mm;margin-bottom:3mm}.brand-logo{display:block;width:19mm;height:19mm;object-fit:contain}.brand-name{color:#176653;font-weight:700;font-size:10px}.title-block h1{margin:1mm 0 0;font-size:19px;line-height:1.25}.document-identity{display:grid;gap:1.5mm;margin:0}.document-identity div{display:flex;justify-content:space-between;gap:3mm;border-bottom:1px solid #d8e0df;padding-bottom:1mm}.document-identity dt{color:#66736f}.document-identity dd{margin:0;font-weight:700;direction:ltr;unicode-bidi:isolate}.shipment-identity{display:grid;grid-template-columns:1fr 1.5fr .72fr;gap:2mm;margin-bottom:3mm}.shipment-identity div,.adjustment-reason{min-width:0;border:1px solid #d8e0df;background:#f5f8f7;padding:2mm 2.5mm}.shipment-identity span,.adjustment-reason span{display:block;color:#66736f;font-size:8px}.shipment-identity strong,.adjustment-reason strong{display:block;margin-top:.5mm;overflow-wrap:anywhere}.adjustment-reason{margin-bottom:3mm;border-right:3px solid #176653}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th,td{border:1px solid #aebbb7;padding:1.45mm 1.2mm;vertical-align:middle;overflow-wrap:anywhere}th{background:#e9f2ef;color:#174d40;font-size:8px;font-weight:700}.continuation-header th{padding:.8mm 1.2mm;background:#fff;border-color:#aebbb7;color:#66736f;text-align:right}.continuation-header span{font-weight:600}.continuation-header b{float:left;direction:ltr;unicode-bidi:isolate;color:#174d40}.row-number{width:7mm}.identity-column{width:23mm}.number-column{width:16mm}.unit-column{width:16mm}.money-column{width:24mm}.contract-heading td{padding:1.2mm 1.5mm;background:#f0f4f3;color:#174d40;font-weight:700}.contract-subtotal td{background:#f8faf9;font-weight:600}.identity-value{direction:ltr;text-align:left;font-size:7.6px;color:#57635f}.numeric{direction:ltr;unicode-bidi:isolate;text-align:left;font-variant-numeric:tabular-nums;white-space:nowrap}.strong{font-weight:700}.grand-total{display:grid;grid-template-columns:1fr repeat(3,31mm);gap:2mm;align-items:stretch;margin-top:3mm;border:1px solid #8ba299;border-right:3px solid #176653;background:#f5f8f7;padding:2mm;break-inside:avoid;page-break-inside:avoid}.grand-total>span{align-self:center;color:#174d40;font-size:11px;font-weight:700}.grand-total div{display:flex;flex-direction:column}.grand-total small{color:#66736f}.grand-total strong{direction:ltr;text-align:left;font-size:11px;font-variant-numeric:tabular-nums}.grand-total .net{border-right:1px solid #b8c6c1;padding-right:2mm}.adjustment-total{border-right-color:#9b5c13;background:#fff8ed}@media print{tr{break-inside:avoid;page-break-inside:avoid}.document-header{break-inside:avoid}.shipment-identity{break-inside:avoid}}
  </style></head><body>${body}</body></html>`;
};

export const renderDispatchDocumentPdf = async (
  input: DispatchDocumentRenderData,
): Promise<RenderedDispatchDocument> => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderDispatchDocumentHtml(input), { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map(async (image) => {
        if (!image.complete) await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error('Dispatch PDF image failed to load')), { once: true });
        });
        if (typeof image.decode === 'function') await image.decode();
      }));
    })()`);
    await page.emulateMediaType('print');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const bytes = Buffer.from(pdf);
    return {
      bytes,
      metadata: {
        documentId: input.documentId,
        kind: input.kind,
        mimeType: 'application/pdf',
        size: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        templateVersion: input.templateVersion,
        generatorVersion: 'chromium-pdf-v1',
      },
    };
  } finally {
    await browser.close();
  }
};
