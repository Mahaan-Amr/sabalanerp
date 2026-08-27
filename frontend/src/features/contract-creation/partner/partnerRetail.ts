import { DecimalSchema, QuantitySchema, type Money } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

export interface PartnerRetailRow {
  productRowId: string;
  quantity: string;
  unit: string;
  inquiryRow: PartnerInquiryRow;
  retailUnitPrice: Money;
}

export function defaultPartnerRetailRows(rows: Omit<PartnerRetailRow, 'retailUnitPrice'>[]): PartnerRetailRow[] {
  return rows.map(row => {
    if (!row.inquiryRow.approvedPrice || !row.inquiryRow.approvedRowBinding) throw new Error('Approved row required');
    return { ...row, retailUnitPrice: { ...row.inquiryRow.approvedPrice } };
  });
}

export function partnerRetailIntentRows(rows: PartnerRetailRow[]): PartnerDraftIntent['rows'] {
  return rows.map(row => {
    if (!row.inquiryRow.approvedRowBinding) throw new Error('Approved row required');
    return { productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding, retailUnitPrice: row.retailUnitPrice };
  });
}

// Only a preview of net commercial difference. The Case writer owns final
// reconciliation and declared precision. No tax, fee, inferred FX or binary
// floating-point amount participates in this warning.
type Decimal = { digits: bigint; scale: number };
function decimal(value: string): Decimal {
  DecimalSchema.parse(value);
  const [whole, fraction = ''] = value.split('.');
  return { digits: BigInt(whole + fraction), scale: fraction.length };
}
function add(left: Decimal, right: Decimal, subtract = false): Decimal {
  const scale = Math.max(left.scale, right.scale);
  return { digits: left.digits * BigInt('1' + '0'.repeat(scale - left.scale))
    + right.digits * BigInt('1' + '0'.repeat(scale - right.scale)) * BigInt(subtract ? -1 : 1), scale };
}
function product(left: string, right: string): Decimal {
  const a = decimal(left); const b = decimal(right);
  return { digits: a.digits * b.digits, scale: a.scale + b.scale };
}
function display(value: Decimal): string {
  const negative = value.digits < BigInt(0);
  const digits = (negative ? -value.digits : value.digits).toString().padStart(value.scale + 1, '0');
  const result = value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.?0+$/, '') : digits;
  return (negative ? '-' : '') + result;
}

export function partnerRetailSummary(rows: PartnerRetailRow[], discount: Money) {
  let wholesale = decimal('0'); let retail = decimal('0');
  for (const row of rows) {
    const approved = row.inquiryRow.approvedPrice;
    if (!approved || approved.currency !== discount.currency || row.retailUnitPrice.currency !== discount.currency) {
      return { valid: false as const, field: 'price' as const, productRowId: row.productRowId, message: 'واحد پول ردیف‌ها یکسان نیست؛ قیمت تأییدشده را بررسی کنید.' };
    }
    if (!DecimalSchema.safeParse(row.retailUnitPrice.amount).success) return {
      valid: false as const, field: 'price' as const, productRowId: row.productRowId, message: 'قیمت فروش را کامل و با عدد مثبت یا صفر وارد کنید.',
    };
    try {
      QuantitySchema.parse(row.quantity);
      wholesale = add(wholesale, product(row.quantity, approved.amount));
      retail = add(retail, product(row.quantity, row.retailUnitPrice.amount));
    } catch {
      return { valid: false as const, field: 'quantity' as const, productRowId: row.productRowId, message: 'مقدار و قیمت تأییدشده را بررسی کنید.' };
    }
  }
  try { retail = add(retail, decimal(discount.amount), true); }
  catch { return { valid: false as const, field: 'discount' as const, message: 'مبلغ تخفیف را کامل وارد کنید.' }; }
  if (retail.digits < BigInt(0)) return { valid: false as const, field: 'discount' as const, message: 'تخفیف نمی‌تواند از جمع فروش بیشتر باشد.' };
  const difference = add(retail, wholesale, true);
  return { valid: true as const, wholesale: display(wholesale), retail: display(retail), difference: display(difference), loss: difference.digits < BigInt(0) };
}

export const partnerMoneyText = (amount: string, currency: Money['currency']) =>
  `${amount.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])} ${currency === 'IRR' ? 'ریال' : 'تومان'}`;
