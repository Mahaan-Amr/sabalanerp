import { getPrintTemplateLogoDataUri, renderYekanFontFaces } from '../../utils/printTemplate';
import type { DispatchProductPrintRow } from '../../utils/printTemplate';
import type { DispatchContractContact } from '../../services/dispatchDocuments/contractPrintSource';

export const escapePrint = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const printDigits = (value: string) => value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
const blank = '—';
const ltr = (value: string) => `<bdi dir="ltr">${escapePrint(printDigits(value || '_'))}</bdi>`;
const field = (label: string, value: string) => `<div><strong>${label}</strong> ${value}</div>`;
export const printSection = (title: string, html: string, className = '') =>
  `<section class="${className}"><h2>${title}</h2>${html}</section>`;
const grid = (html: string) => `<div class="grid">${html}</div>`;
export const shipmentSignature = '<section class="signature">امضای تحویل‌گیرنده</section>';

export function shipmentHeader(input: {
  title: string; number: string; numberLabel: string; loadingNumber: string; date: string; logo?: string;
}) {
  return `<header><img src="${escapePrint(input.logo ?? getPrintTemplateLogoDataUri())}" alt="">
    <h1>${input.title}</h1><div class="meta">${field(input.numberLabel, ltr(input.number))}
    ${input.loadingNumber ? field('شماره بارگیری', ltr(input.loadingNumber)) : ''}
    ${field('تاریخ صدور', escapePrint(input.date))}</div></header>`;
}

export function shipmentParties(name: string, contracts: DispatchContractContact[], invoice: boolean, counterparty?: string) {
  const contacts: DispatchContractContact[] = contracts.length ? contracts : [{ contractNumber: '', project: '', address: '', customerPhone: '', manager: '', managerPhone: '' }];
  const distinctSellers = new Set(contacts.map(contact => JSON.stringify([contact.sellerName || '', contact.sellerPhone || ''])));
  const sellerFields = (contact: DispatchContractContact) =>
    field('کارشناس فروش', escapePrint(contact.sellerName || '_')) + field('تلفن فروشنده', ltr(contact.sellerPhone || ''));
  const company = field('نام', 'سنگ سبلان') + field('نشانی', 'بلوار دکتر حسابی')
    + field('تلفن ثابت', ltr('07191010900'));
  const sender = distinctSellers.size === 1 ? grid(company + sellerFields(contacts[0]))
    : grid(company) + contacts.map(contact =>
      grid(field('قرارداد', ltr(contact.contractNumber)) + sellerFields(contact))).join('');
  return printSection(invoice ? 'مشخصات فروشنده' : 'مشخصات فرستنده', sender, 'contact-section')
    + contacts.map(contact => printSection(
      contacts.length > 1 ? `مشخصات خریدار و پروژه · قرارداد ${escapePrint(printDigits(contact.contractNumber))}` : 'مشخصات خریدار و پروژه',
      grid(field('خریدار', escapePrint(name)) + field('تلفن مشتری', ltr(contact.customerPhone))
        + field('طرف‌حساب', escapePrint(counterparty || name))
        + field('پروژه', escapePrint(contact.project || '_')) + field('مدیر پروژه', escapePrint(contact.manager || '_'))
        + field('تلفن مدیر پروژه', ltr(contact.managerPhone))
        + `<div class="address">${field('نشانی پروژه', escapePrint(contact.address || '_'))}</div>`), 'contact-section',
    )).join('');
}

export function shipmentTerms(contractNumbers: string[]) {
  const numbers = [...new Set(contractNumbers.map(number => number.trim()).filter(number => number && number !== 'ثبت نشده'))];
  const contract = numbers.length > 1 ? 'قراردادهای شمارهٔ' : 'قرارداد شمارهٔ';
  const reference = numbers.length ? `${contract} ${numbers.map(ltr).join('، ')}` : 'قرارداد';
  return printSection('توضیحات', `<ul class="shipment-terms">
    <li>قیمت اقلام و نحوهٔ تسویه طبق ${reference} مورد تأیید می‌باشد.</li>
    <li>هزینهٔ ارسال بار بر عهدهٔ خریدار می‌باشد.</li>
    <li>تحویل‌گیرندهٔ گرامی و رسیدکنندهٔ فاکتورهای ارسالی به پروژه، به‌عنوان نمایندهٔ قانونی خریدار محسوب می‌شوند.</li>
    <li>خریدار گرامی، لطفاً قبل از تخلیهٔ بار از کیفیت، سالم بودن و متراژ سنگ تحویلی اطمینان حاصل فرمایید. تمامی سفارشات فوق تا تسویه‌حساب نهایی نزد خریدار به امانت می‌باشد.</li>
    <li>قرارداد فروش صادرشده صرفاً در صورت تسویهٔ کامل مبلغ توسط خریدار دارای اعتبار می‌باشد، در غیر این صورت فاقد اعتبار است.</li>
  </ul>`, 'terms-section');
}

export function shipmentTable(heads: string[], rows: string[][]) {
  return `<table><thead><tr>${heads.map(head => `<th>${escapePrint(head)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(row => `<tr>${row.map(cell => `<td>${escapePrint(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export type ShipmentPrintRow = Omit<DispatchProductPrintRow, 'rate' | 'total'> & {
  index?: string; rate?: string; total?: string;
};

export function shipmentItemTable(groups: Array<{ reference?: string; rows: ShipmentPrintRow[] }>, invoice: boolean) {
  const heads = ['ردیف', 'کد', 'شرح', 'دسته', 'طول - متر', 'عرض - متر', 'تعداد', 'متر طول', 'متر مربع',
    ...(invoice ? ['نرخ - ریال', 'مبلغ کل - ریال'] : [])];
  const widths = invoice ? [4,9,23,9,7,7,5,7,7,11,11] : [5,12,32,12,8,8,6,9,8];
  return `<table class="items"><colgroup>${widths.map(width => `<col style="width:${width}%">`).join('')}</colgroup>
    <thead><tr>${heads.map(head => `<th>${head}</th>`).join('')}</tr></thead>
    ${groups.map(group => `<tbody>${group.reference ? `<tr><td class="ref" colspan="${heads.length}">${escapePrint(printDigits(group.reference))}</td></tr>` : ''}
      ${group.rows.map(row => {
        if (row.category === 'توضیحات') return `<tr><td colspan="${heads.length}" class="note-cell">${escapePrint(row.description)}</td></tr>`;
        const category = /[A-Za-z]/.test(row.category) ? (row.index ? 'محصول' : 'خدمات') : row.category;
        const values = [row.index, row.code, localizeMeasurementText(row.description), category,
          row.length, row.width, row.count, row.linearMeasurement, row.squareMeasurement,
          ...(invoice ? [row.rate, row.total] : [])];
        return `<tr class="${row.index ? 'product' : 'operation'}">${values.map((cell, index) =>
          `<td${index === 2 ? ' class="desc"' : ''}>${escapePrint(printDigits(cell || blank))}</td>`).join('')}</tr>`;
      }).join('')}</tbody>`).join('')}</table>`;
}

const units = new Map([
  ['meter', 'متر طول'], ['m', 'متر طول'], ['linearmeter', 'متر طول'], ['متر', 'متر طول'],
  ['squaremeter', 'متر مربع'], ['squaremeters', 'متر مربع'], ['m2', 'متر مربع'], ['m²', 'متر مربع'],
  ['مترمربع', 'متر مربع'], ['cm', 'سانتی‌متر'], ['mm', 'میلی‌متر'],
  ['count', 'عدد'], ['piece', 'عدد'], ['pcs', 'عدد'], ['physicalpiece', 'عدد'],
  ['ton', 'تن'], ['kg', 'کیلوگرم'], ['kilogram', 'کیلوگرم'], ['set', 'دستگاه'],
]);

export function shipmentUnitLabel(unit: string) {
  const label = unit.trim();
  return units.get(label.toLowerCase()) || (/^[\p{Script=Arabic}\s\u200c]+$/u.test(label) ? label : 'واحد نامشخص');
}

const measurementTokens = new Map([['cm', 'سانتی‌متر'], ['mm', 'میلی‌متر'], ['m', 'متر'],
  ['m2', 'متر مربع'], ['m²', 'متر مربع'], ['kg', 'کیلوگرم']]);
const localizeMeasurementText = (value: string) =>
  value.replace(/([0-9۰-۹])\s*(cm|mm|m²|m2|m|kg)(?![a-zA-Z0-9])/gi,
    (_, digit: string, unit: string) => `${digit} ${measurementTokens.get(unit.toLowerCase())}`);

export function shipmentQuantity(quantity: string, unit: string) {
  const amount = quantity.replace('.', '٫');
  const label = shipmentUnitLabel(unit);
  if (label === 'متر طول') return { count: '', linearMeasurement: amount, squareMeasurement: '' };
  if (label === 'متر مربع') return { count: '', linearMeasurement: '', squareMeasurement: amount };
  return { count: label === 'عدد' ? amount : `${amount} ${label}`, linearMeasurement: '', squareMeasurement: '' };
}

export function shipmentHtml(title: string, content: string, fonts = renderYekanFontFaces()) {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
    <style>${fonts}
    @page { size: A4; margin: 10mm 8mm }
    * { box-sizing: border-box }
    body { margin: 0; font: 12px/1.65 'Yekan Bakh', Tahoma, sans-serif; color: #111827 }
    header { display: flex; align-items: center; justify-content: space-between; gap: 3mm; margin-bottom: 2mm }
    header img { width: 38mm }
    header h1 { font-size: 20px; margin: 0; text-align: center }
    section, .meta { border: 1px solid #d1d5db; border-radius: 8px }
    section { margin-bottom: 2mm }
    .meta { padding: 2mm 3mm; min-width: 43mm; font-size: 10px }
    h2 { margin: 0; padding: 1.2mm 3mm; border-bottom: 1px solid #d1d5db; border-radius: 7px 7px 0 0; background: #f3f4f6; font-size: 13px }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 1mm 3mm; padding: 1.5mm 3mm }
    .grid div { min-width: 0; overflow-wrap: anywhere }
    .grid .address { grid-column: 1/-1; border-top: 1px solid #e5e7eb; padding-top: 1mm; margin-top: .5mm }
    table { border-collapse: collapse; width: 100%; font-size: 11px }
    th, td { padding: .9mm; text-align: center; border: 1px solid #d1d5db }
    th { background: #f3f4f6; font-size: 10px }
    .items { table-layout: fixed; line-height: 1.4 }
    .items td { overflow-wrap: anywhere }
    .items .desc { text-align: right }
    .items .operation td { padding-block: .6mm }
    .items .operation .desc { padding-right: 2mm }
    .items th:first-child, .items td:first-child { border-right: 0 }
    .items th:last-child, .items td:last-child { border-left: 0 }
    .ref, .note-cell { padding: 1mm 3mm; text-align: right; background: #f9fafb }
    .settlement-panel { display: grid; grid-template-columns: minmax(0, 1fr) 64mm; gap: 3mm; align-items: start; break-inside: avoid }
    .settlement-panel .summary { display: flex; flex-direction: column; gap: 0 }
    .settlement-panel .summary p { order: 1 }
    .settlement-panel .summary table { width: 100% }
    .summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 4mm; margin-bottom: 2mm }
    .summary p { margin: 2mm 0 }
    .summary table { width: 64mm; flex: none }
    .summary tr:last-child { background: #f3f4f6; font-weight: 700 }
    .shipment-end { display: grid; grid-template-columns: minmax(0, 1fr) 62mm; gap: 3mm; align-items: stretch; margin-top: 2mm }
    .shipment-end .signature { width: auto }
    .signature { width: 70mm; min-height: 18mm; padding: 2mm 3mm }
    .shipment-terms { margin: 1mm 0; padding-inline-start: 6mm; padding-inline-end: 3mm; font-size: 10px }
    .shipment-terms li { break-inside: avoid }
    .terms-section { break-inside: avoid }
    .note { color: #4b5563; font-size: 10px; margin: 1mm 3mm }
    thead { display: table-header-group }
    thead, tr, header, .summary, .signature, .contact-section, .shipment-end { break-inside: avoid }
    h2, .ref, .product { break-after: avoid }

    </style></head><body>${content}</body></html>`;
}
