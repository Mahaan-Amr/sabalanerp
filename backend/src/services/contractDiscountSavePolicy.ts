import { Prisma } from '@prisma/client';
import { contractDiscountEligibleBase } from './contractDiscountEvidence';

export const CONTRACT_DISCOUNT_REENTRY_REQUIRED =
  'مبنای تخفیف یا مبلغ و درصد آن با اقلام فعلی قرارداد سازگار نیست. در مرحله پرداخت، مبلغ یا درصد تخفیف را دوباره وارد کنید و سپس قرارداد را ذخیره کنید.';

/** Validate new commercial evidence; never repair an agreed positive discount implicitly. */
export function assertContractDiscountReadyForSave(
  contractData: unknown,
  rows: readonly { productRowId: string; baseAmountToman?: string | null }[],
): void {
  if (!contractData || typeof contractData !== 'object' || Array.isArray(contractData)) return;
  const data = contractData as Record<string, unknown>;
  const raw = data.discount;
  // Historical absence and explicit zero are handled by the existing no-discount evidence policy.
  if (raw === null || raw === undefined) return;
  try {
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    const discount = raw as Record<string, unknown>;
    const decimal = (value: unknown) => {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') throw new Error();
      const result = new Prisma.Decimal(String(value));
      if (!result.isFinite()) throw new Error();
      return result;
    };
    const amount = decimal(discount.amount);
    const percent = decimal(discount.percent);
    if (discount.enabled === false && amount.eq(0) && percent.eq(0)) return;
    if (discount.enabled !== true || amount.lte(0) || percent.lte(0)) throw new Error();
    if (!Array.isArray(data.products)) throw new Error();
    const snapshots = new Map(data.products.map((product: Record<string, unknown>) => [
      String(product.rowId ?? product.productRowId ?? ''), product,
    ]));
    const base = contractDiscountEligibleBase(snapshots, rows);
    if (!base.eq(decimal(discount.baseSubtotal))) throw new Error();
    const cap = decimal(discount.maxDiscountPercent);
    if (cap.lte(0) || cap.gt(100) || percent.gt(cap)) throw new Error();
    const calculated = base.mul(percent).div(100);
    if (discount.inputMode === 'AMOUNT_TOMAN') {
      if (!amount.isInteger() || amount.gt(base.mul(cap).div(100).floor()) ||
          !calculated.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).eq(amount)) throw new Error();
    } else if (discount.inputMode !== undefined || !calculated.eq(amount)) throw new Error();
  } catch {
    throw new Error(CONTRACT_DISCOUNT_REENTRY_REQUIRED);
  }
}
