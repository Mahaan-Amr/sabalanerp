import { SignedDecimalSchema } from '@sabalanerp/partner-sales-contracts';

export const partnerPaymentMethodCopy: Record<string, string> = {
  CASH: 'نقدی', BANK_TRANSFER: 'انتقال بانکی', CHECK: 'چک', CREDIT: 'اعتباری',
};

export function formatPartnerMoney(amount: string | number | null | undefined, currency: 'IRR' | 'IRT' | string) {
  if (!['IRR', 'IRT'].includes(currency) || (typeof amount === 'number' && !Number.isSafeInteger(amount))) return 'داده معتبر در دسترس نیست';
  const value = readPartnerDecimalInput(amount == null ? '' : String(amount));
  if (value === null) return 'داده معتبر در دسترس نیست';
  const [integer, fraction] = value.split('.');
  const whole = integer === '-0' ? '−۰' : BigInt(integer).toLocaleString('fa-IR');
  const decimal = fraction ? `٫${fraction.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}` : '';
  return `${whole}${decimal} ${currency === 'IRT' ? 'تومان' : 'ریال'}`;
}

/** Exact input normalization only; no financial calculation or rounding. */
export function readPartnerDecimalInput(raw: string): string | null {
  const value = raw.trim().replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace('٫', '.');
  if (!SignedDecimalSchema.safeParse(value).success) return null;
  const [integer, fraction] = value.split('.');
  const decimals = fraction?.replace(/0+$/, '');
  return `${integer === '-0' && decimals ? '-0' : BigInt(integer)}${decimals ? `.${decimals}` : ''}`;
}
