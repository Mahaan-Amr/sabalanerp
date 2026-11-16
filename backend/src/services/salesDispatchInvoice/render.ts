import { Prisma } from '@prisma/client';
import {
  escapePrint, printDigits, printSection, shipmentHeader, shipmentHtml, shipmentItemTable,
  shipmentParties, shipmentQuantity, shipmentSignature, shipmentTable, shipmentTerms, shipmentUnitLabel, type ShipmentPrintRow,
} from '../../documents/dispatch/dispatchPrintLayout';
import type { DispatchProductPrintRow } from '../../utils/printTemplate';
import { pricingCurrencyKind } from '../approvedPricing/domain';
import type { InvoiceSource } from './source';

const Decimal = Prisma.Decimal.clone({ precision: 100 });
export const invoiceNumber = (value: string) => printDigits(value.replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
export type IssuedInvoiceSnapshot = InvoiceSource & {
  number: string;
  issuedAt: string;
  replacesNumber: string | null;
};

const parsePrintNumber = (value: string) => {
  const normalized = value.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/٬/g, '').replace('٫', '.').replace('−', '-');
  return /^\d+(\.\d+)?$/.test(normalized) ? new Decimal(normalized) : undefined;
};

function rialRate(value: string, multiplier: number) {
  const [rate, unit] = value.split(' / ', 2);
  const amount = parsePrintNumber(rate);
  if (!amount) return value;
  const [whole, fraction] = amount.mul(multiplier).toFixed().split('.');
  const formatted = invoiceNumber(whole) + (fraction ? `٫${printDigits(fraction)}` : '');
  return [formatted, unit ? shipmentUnitLabel(unit) : ''].filter(Boolean).join(' / ');
}

function splitApprovedGross(rows: DispatchProductPrintRow[], contractedGross: string | undefined, grossRials: InstanceType<typeof Decimal>) {
  const amounts = rows.map(row => parsePrintNumber(row.total));
  const total = amounts.reduce<InstanceType<typeof Decimal>>((sum, amount) => sum.plus(amount || 0), new Decimal(0));
  // If legacy evidence has incomplete itemization, preserve the approved
  // aggregate and show the saved service rates without inventing a split.
  if (!contractedGross || total.isZero() || !total.eq(new Decimal(contractedGross))) {
    return rows.map((_, index) => index === 0 ? invoiceNumber(grossRials.toFixed(0)) : '');
  }
  let subtotal = new Decimal(0);
  let previous = new Decimal(0);
  return amounts.map(amount => {
    if (!amount) return '';
    subtotal = subtotal.plus(amount);
    const current = grossRials.mul(subtotal).div(total).toDecimalPlaces(0);
    const result = invoiceNumber(current.minus(previous).toFixed(0));
    previous = current;
    return result;
  });
}

export function renderSalesInvoice(snapshot: IssuedInvoiceSnapshot, voidReason?: string) {
  const currencyCode = snapshot.currency.trim().toUpperCase();
  const multiplier = currencyCode === 'IRT' || (currencyCode !== 'IRR' && pricingCurrencyKind(snapshot.currency) === 'TOMAN') ? 10 : 1;
  const money = (value: string) => invoiceNumber(new Decimal(value).mul(multiplier).toFixed(0));
  const date = new Date(snapshot.issuedAt).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' });
  const title = 'صورتحساب فروش کالا و خدمات';
  let running = new Decimal(0);
  const groups = snapshot.lines.map((line, index) => {
    const previous = running.toDecimalPlaces(0);
    running = running.plus(new Decimal(line.grossAmount).mul(multiplier));
    const gross = running.toDecimalPlaces(0).minus(previous);
    const savedRows = snapshot.print?.rows[line.key] || [];
    const [saved, ...services] = savedRows;
    const allocated = splitApprovedGross(savedRows, snapshot.print?.contractedGross?.[line.key], gross);
    const legacyDetails = !snapshot.print && line.details.length ? [{
      code: '', description: line.details.join('، '), category: 'توضیحات',
      length: '', width: '', count: '', linearMeasurement: '', squareMeasurement: '',
    }] : [];
    const allocatedQuantity = shipmentQuantity(line.quantity, line.unit);
    const main: ShipmentPrintRow = {
      code: saved?.code && saved.code !== '—' ? saved.code : line.code,
      description: saved?.description || line.label, category: saved?.category || 'محصول',
      length: saved?.length || line.length, width: saved?.width || line.width, ...allocatedQuantity,
      count: allocatedQuantity.count || (saved?.count === '۰' ? '' : saved?.count) || '',
      index: String(index + 1),
      rate: saved?.rate ? rialRate(saved.rate, multiplier)
        : services.length || new Decimal(line.quantity).isZero() ? ''
          : invoiceNumber(new Decimal(line.grossAmount).mul(multiplier).div(line.quantity).toFixed(0)),
      total: allocated[0] ?? invoiceNumber(gross.toFixed(0)),
    };
    return {
      reference: `قرارداد ${line.contractNumber}${line.contractRowNumber ? ` · ردیف قرارداد ${line.contractRowNumber}` : ''}`,
      rows: [main, ...services.map((service, serviceIndex) => ({
        ...service, rate: rialRate(service.rate, multiplier), total: allocated[serviceIndex + 1],
      })), ...legacyDetails],
    };
  });
  const transport = snapshot.drivers.map(driver => {
    const assigned = snapshot.lines.flatMap((line, index) => line.driverId === driver.id ? [{ line, index }] : []);
    const totals = new Map<string, InstanceType<typeof Decimal>>();
    for (const { line } of assigned) totals.set(line.unit, (totals.get(line.unit) || new Decimal(0)).plus(line.quantity));
    return [driver.name, driver.plate, invoiceNumber(driver.waybillNumber), [
      `ردیف‌ها: ${assigned.map(({ index }) => invoiceNumber(String(index + 1))).join('، ')}`,
      ...[...totals].map(([unit, quantity]) => `${printDigits(quantity.toFixed())} ${shipmentUnitLabel(unit)}`),
    ].join(' · ')];
  });
  return shipmentHtml(title,
    shipmentHeader({ title, number: snapshot.number, numberLabel: 'شماره فاکتور', loadingNumber: snapshot.loadingNumber, date })
    + (voidReason || snapshot.replacesNumber ? printSection('وضعیت فاکتور',
      `<p class="note">${voidReason ? `باطل‌شده · ${escapePrint(voidReason)}` : ''}${snapshot.replacesNumber ? ` · جایگزین فاکتور ${escapePrint(invoiceNumber(snapshot.replacesNumber))}` : ''}</p>`) : '')
    + shipmentParties(snapshot.customerName, snapshot.print?.contacts || [], true, snapshot.counterparty)
    + printSection('مشخصات کالا یا خدمات مورد معامله', shipmentItemTable(groups, true))
    + `<div class="settlement-panel">${shipmentTerms(snapshot.print?.contacts.map(contact => contact.contractNumber)
      ?? snapshot.lines.map(line => line.contractNumber))}
      <div class="summary"><p><strong>مبلغ به حروف</strong><br>${rialsInWords(new Decimal(snapshot.netAmount).mul(multiplier).toFixed(0))} ریال</p>
      ${shipmentTable(['شرح', 'مبلغ (ریال)'], [
        ['جمع کل', money(snapshot.grossAmount)], ['اضافات', '—'],
        ['تخفیف', money(snapshot.discountAmount)], ['مالیات و عوارض', '—'],
        ['مبلغ پرداختنی', money(snapshot.netAmount)],
      ])}</div></div>`
    + `<div class="shipment-end">${printSection('مشخصات راننده و سهم بار',
      shipmentTable(['نام راننده', 'پلاک خودرو', 'شماره بارنامه', 'اقلام و مقدار بار'], transport))}${shipmentSignature}</div>`);
}

function rialsInWords(integer: string) {
  const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
  const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  const scales = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون', 'کوادریلیون', 'کوینتیلیون'];
  let number = BigInt(integer);
  if (number === 0n) return 'صفر';
  const groups: string[] = [];
  for (let scale = 0; number > 0n; number /= 1000n, scale++) {
    if (scale >= scales.length) return invoiceNumber(integer);
    const part = Number(number % 1000n), rest = part % 100;
    if (part) groups.unshift([hundreds[Math.floor(part / 100)], ...(rest >= 10 && rest < 20
      ? [teens[rest - 10]] : [tens[Math.floor(rest / 10)], ones[rest % 10]])].filter(Boolean).join(' و ')
      + (scale ? ` ${scales[scale]}` : ''));
  }
  return groups.join(' و ');
}
