import { DecimalSchema, QuantitySchema, type Money } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryRow } from '../../partner-sales/inquiries/inquiryPresentation';
import type { PartnerDraftIntent } from './partnerCaseSubmission';

export interface PartnerRetailRow {
  productRowId: string;
  quantity: string;
  unit: string;
  inquiryRow: PartnerInquiryRow;
  retailUnitPrice: Money;
  /** Canonical blended rate: Partner material rate plus system-owned components. */
  retailEffectiveUnitPrice?: Money;
  wholesaleUnitPrice?: Money;
}

export function refreshPartnerInquiryRow(row: PartnerRetailRow, inquiryRow: PartnerInquiryRow): PartnerRetailRow {
  const sameApproval = row.inquiryRow.rowId === inquiryRow.rowId
    && row.inquiryRow.revision === inquiryRow.revision
    && JSON.stringify(row.inquiryRow.approvedRowBinding) === JSON.stringify(inquiryRow.approvedRowBinding)
    && row.inquiryRow.approvedPrice?.amount === inquiryRow.approvedPrice?.amount
    && row.inquiryRow.approvedPrice?.currency === inquiryRow.approvedPrice?.currency;
  if (sameApproval && inquiryRow.approvedPrice) return { ...row, inquiryRow };
  const { wholesaleUnitPrice: _staleQuote, ...withoutStaleQuote } = row;
  void _staleQuote;
  return { ...withoutStaleQuote, inquiryRow };
}

export function defaultPartnerRetailRows(rows: (Omit<PartnerRetailRow, 'retailUnitPrice'> & { retailUnitPrice?: Money })[]): PartnerRetailRow[] {
  return rows.map(row => ({ ...row, retailUnitPrice: row.retailUnitPrice ??
    (row.inquiryRow.approvedPrice ? { ...row.inquiryRow.approvedPrice } : { amount: '', currency: 'IRT' }) }));
}

export function partnerRetailIntentRows(rows: PartnerRetailRow[]): PartnerDraftIntent['rows'] {
  return rows.map(row => ({ productRowId: row.productRowId,
    ...(row.inquiryRow.approvedRowBinding ? { approvedRowBinding: row.inquiryRow.approvedRowBinding } : {}),
    retailUnitPrice: row.retailUnitPrice }));
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

function retailSubtotal(rows: PartnerRetailRow[], currency: Money['currency']): Decimal | null {
  let subtotal = decimal('0');
  try {
    for (const row of rows) {
      const effectiveRetail = row.retailEffectiveUnitPrice ?? row.retailUnitPrice;
      if (effectiveRetail.currency !== currency) return null;
      QuantitySchema.parse(row.quantity);
      subtotal = add(subtotal, product(row.quantity, effectiveRetail.amount));
    }
    return subtotal;
  } catch { return null; }
}

/** Derive the frozen customer discount without touching any Sabalan price. */
export function partnerRetailDiscountFromPercent(rows: PartnerRetailRow[], percent: string,
  currency: Money['currency']): Money | null {
  if (!DecimalSchema.safeParse(percent).success || Number(percent) > 100) return null;
  const subtotal = retailSubtotal(rows, currency);
  if (!subtotal) return null;
  const rate = decimal(percent);
  return { amount: display({ digits: subtotal.digits * rate.digits,
    scale: subtotal.scale + rate.scale + 2 }), currency };
}

export function partnerRetailSubtotal(rows: PartnerRetailRow[], currency: Money['currency']): string | null {
  const subtotal = retailSubtotal(rows, currency);
  return subtotal ? display(subtotal) : null;
}

export function partnerRetailSummary(rows: PartnerRetailRow[], discount: Money) {
  let wholesale = decimal('0'); let retail = decimal('0'); let pricingReady = true;
  for (const row of rows) {
    const approved = row.wholesaleUnitPrice;
    if (row.retailUnitPrice.currency !== discount.currency || (approved && approved.currency !== discount.currency)) {
      return { valid: false as const, field: 'price' as const, productRowId: row.productRowId, message: 'واحد پول ردیف‌ها یکسان نیست؛ قیمت تأییدشده را بررسی کنید.' };
    }
    if (!DecimalSchema.safeParse(row.retailUnitPrice.amount).success) return {
      valid: false as const, field: 'price' as const, productRowId: row.productRowId, message: 'قیمت فروش را کامل و با عدد مثبت یا صفر وارد کنید.',
    };
    try {
      QuantitySchema.parse(row.quantity);
      if (approved) wholesale = add(wholesale, product(row.quantity, approved.amount));
      else pricingReady = false;
      const effectiveRetail = row.retailEffectiveUnitPrice ?? row.retailUnitPrice;
      if (effectiveRetail.currency !== discount.currency) throw new Error('currency mismatch');
      retail = add(retail, product(row.quantity, effectiveRetail.amount));
    } catch {
      return { valid: false as const, field: 'quantity' as const, productRowId: row.productRowId, message: 'مقدار و قیمت تأییدشده را بررسی کنید.' };
    }
  }
  try { retail = add(retail, decimal(discount.amount), true); }
  catch { return { valid: false as const, field: 'discount' as const, message: 'مبلغ تخفیف را کامل وارد کنید.' }; }
  if (retail.digits < BigInt(0)) return { valid: false as const, field: 'discount' as const, message: 'تخفیف نمی‌تواند از جمع فروش بیشتر باشد.' };
  const difference = add(retail, wholesale, true);
  return { valid: true as const, pricingReady, wholesale: pricingReady ? display(wholesale) : undefined,
    retail: display(retail), difference: pricingReady ? display(difference) : undefined,
    loss: pricingReady && difference.digits < BigInt(0) };
}

export function partnerRetailRowSummary(row: PartnerRetailRow) {
  if (!row.wholesaleUnitPrice || row.wholesaleUnitPrice.currency !== row.retailUnitPrice.currency) return null;
  try {
    const wholesale = product(row.quantity, row.wholesaleUnitPrice.amount);
    const retail = product(row.quantity, (row.retailEffectiveUnitPrice ?? row.retailUnitPrice).amount);
    const difference = add(retail, wholesale, true);
    return { wholesale: display(wholesale), retail: display(retail), difference: display(difference),
      loss: difference.digits < BigInt(0) };
  } catch { return null; }
}

export const partnerMoneyText = (amount: string, currency: Money['currency']) =>
  `${amount.replace(/[0-9]/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])} ${currency === 'IRR' ? 'ریال' : 'تومان'}`;

export function remainingPartnerAmount(total: string, allocated: readonly string[]): string | null {
  try {
    let value = decimal(total);
    for (const amount of allocated) value = add(value, decimal(amount), true);
    return value.digits < BigInt(0) ? null : display(value);
  } catch { return null; }
}

/** Keep the first customer installment equal to the unallocated retail total.
 * The numbered Case is created before the payment step, so its provisional
 * plan must already reconcile with the partner-visible retail envelope. */
export function alignPartnerCustomerPaymentPlan(rows: PartnerRetailRow[], discount: Money,
  plan: PartnerDraftIntent['customerPaymentPlan']): PartnerDraftIntent['customerPaymentPlan'] {
  const summary = partnerRetailSummary(rows, discount);
  const [first, ...later] = plan.installments;
  const firstAmount = summary.valid && first
    ? remainingPartnerAmount(summary.retail, later.map(item => item.amount.amount)) : null;
  return first && firstAmount !== null ? { ...plan, installments: [{ ...first,
    amount: { amount: firstAmount, currency: first.amount.currency } }, ...later] } : plan;
}
