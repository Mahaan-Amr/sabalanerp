import { normalizeDigits } from '@/lib/numberFormat';
import type { MonetaryAmount } from './dispatchDocumentsViewModel';

export function sepidarCheckAmount({ amount, currency }: MonetaryAmount): string | null {
  const isToman = currency === 'IRT' || currency === 'تومان';
  if (!isToman && currency !== 'IRR' && currency !== 'ریال') return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalizeDigits(amount).trim().replace(/,/g, ''));
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  const integer = BigInt(isToman ? whole + (fraction[0] ?? '0') : whole).toString();
  const decimal = (isToman ? fraction.slice(1) : fraction).replace(/0+$/, '');
  const negative = sign === '-' && (integer !== '0' || decimal) ? '-' : '';
  return negative + integer + (decimal ? `.${decimal}` : '');
}
