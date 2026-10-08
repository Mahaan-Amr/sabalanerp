import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';
import type { ContractProduct } from '../types/contract.types';
import { isPreparedProductType } from './preparedProductUtils';
import { contractDiscountEquivalentPercent, maximumContractDiscountToman } from './contractDiscountAmount';

export const DISCOUNT_REENTRY_MESSAGE = 'مبلغ اقلام مشمول تخفیف تغییر کرده است. برای ذخیره قرارداد، مبلغ یا درصد تخفیف را در مرحله پرداخت دوباره وارد کنید.';
export const DISCOUNT_CAP_MESSAGE = 'تخفیف واردشده بیشتر از سقف مجاز است. مبلغ یا درصد تخفیف را اصلاح کنید؛ مقدار واردشده خودکار تغییر نمی‌کند.';

export const getContractDiscountBaseSubtotal = (products: ContractProduct[]) =>
  sumNumericValues(products, product => {
    if (product.meta?.isLayer) return 0;
    const originalTotal = toFiniteNumber(product.originalTotalPrice);
    if (originalTotal > 0) return originalTotal;
    if (isPreparedProductType(product.productType)) return toFiniteNumber(product.totalPrice);
    return toFiniteNumber(product.squareMeters) * toFiniteNumber(product.pricePerSquareMeter);
  });

type DiscountSnapshot = { enabled?: boolean; inputMode?: 'AMOUNT_TOMAN'; amount: number; percent: number; baseSubtotal: number; maxDiscountPercent?: number | null };

/** Saved historical range rules are retained until the user explicitly enters a discount. */
export function contractDiscountSnapshotError(discount: DiscountSnapshot | null | undefined, baseSubtotal: number): string | null {
  if (!discount) return null;
  if (discount.amount > 0 && Math.abs(discount.baseSubtotal - baseSubtotal) > 0.000001) return DISCOUNT_REENTRY_MESSAGE;
  if (!Number.isFinite(discount.amount) || discount.amount < 0 ||
      (discount.inputMode === 'AMOUNT_TOMAN' && !Number.isInteger(discount.amount))) {
    return 'مبلغ تخفیف را به تومان و به‌صورت عدد صحیح صفر یا بیشتر وارد کنید.';
  }
  const maximum = discount.inputMode === 'AMOUNT_TOMAN'
    ? maximumContractDiscountToman(baseSubtotal, discount.maxDiscountPercent ?? 0)
    : baseSubtotal * (discount.maxDiscountPercent ?? 0) / 100;
  if (discount.amount > maximum) return DISCOUNT_CAP_MESSAGE;
  return null;
}

/** Conversion follows an explicit field edit only. Invalid entries remain visible, never clamped. */
export function enterContractDiscount(mode: 'AMOUNT_TOMAN' | 'PERCENT', value: number, baseSubtotal: number) {
  const amount = mode === 'AMOUNT_TOMAN' ? value : Math.round(baseSubtotal * value / 100);
  return {
    amount,
    percentInput: mode === 'PERCENT' ? value : contractDiscountEquivalentPercent(amount, baseSubtotal),
    inputBaseSubtotal: baseSubtotal,
  };
}

export function contractDiscountInputError(input: {
  amount: number; percentInput: number; inputBaseSubtotal: number | null;
  baseSubtotal: number; maxPercent: number; hasRange: boolean;
}): string | null {
  if (!Number.isFinite(input.amount) || input.amount < 0 || !Number.isInteger(input.amount) ||
      !Number.isFinite(input.percentInput) || input.percentInput < 0) {
    return 'مبلغ یا درصد تخفیف معتبر وارد کنید؛ مبلغ تخفیف باید به تومان و عدد صحیح صفر یا بیشتر باشد.';
  }
  if (input.amount === 0 && input.percentInput === 0) return null;
  if (input.inputBaseSubtotal === null || Math.abs(input.inputBaseSubtotal - input.baseSubtotal) > 0.000001) return DISCOUNT_REENTRY_MESSAGE;
  if (!input.hasRange) return 'برای جمع پایه فعلی، بازه تخفیف مجازی تعریف نشده است. تخفیف را صفر کنید یا از مدیر بخواهید بازه مجاز را بررسی کند.';
  if (input.percentInput > input.maxPercent || input.amount > maximumContractDiscountToman(input.baseSubtotal, input.maxPercent)) return DISCOUNT_CAP_MESSAGE;
  return null;
}
