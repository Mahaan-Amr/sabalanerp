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

type ExactDecimal = { digits: bigint; scale: number };
const exactDecimal = (value: string): ExactDecimal | null => {
  const normalized = readPartnerDecimalInput(value);
  if (normalized === null) return null;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = (negative ? normalized.slice(1) : normalized).split('.');
  return { digits: BigInt(`${negative ? '-' : ''}${whole}${fraction}`), scale: fraction.length };
};
const exactText = (value: ExactDecimal) => {
  const negative = value.digits < BigInt(0);
  const raw = (negative ? -value.digits : value.digits).toString().padStart(value.scale + 1, '0');
  const text = value.scale ? `${raw.slice(0, -value.scale)}.${raw.slice(-value.scale)}`.replace(/\.?0+$/, '') : raw;
  return `${negative ? '-' : ''}${text}`;
};

export function subtractPartnerDecimal(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  const first = exactDecimal(left); const second = exactDecimal(right);
  if (!first || !second) return null;
  const scale = Math.max(first.scale, second.scale);
  const factor = (places: number) => BigInt(`1${'0'.repeat(places)}`);
  return exactText({ scale, digits: first.digits * factor(scale - first.scale)
    - second.digits * factor(scale - second.scale) });
}

export function partnerChartMagnitude(value: string | null | undefined) {
  if (!value) return 0;
  const decimal = exactDecimal(value);
  if (!decimal) return 0;
  const sign = decimal.digits < BigInt(0) ? -1 : 1;
  const digits = (decimal.digits < BigInt(0) ? -decimal.digits : decimal.digits).toString();
  return sign * Number(digits.slice(0, 15)) *
    (10 ** (digits.length - decimal.scale - Math.min(15, digits.length)));
}
