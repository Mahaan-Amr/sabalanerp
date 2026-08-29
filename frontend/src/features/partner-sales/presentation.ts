import { formatPrice } from '@/lib/numberFormat';

export const partnerPaymentMethodCopy: Record<string, string> = {
  CASH: 'نقدی', BANK_TRANSFER: 'انتقال بانکی', CHECK: 'چک', CREDIT: 'اعتباری',
};

export function formatPartnerMoney(amount: string | number | null | undefined, currency: 'IRR' | 'IRT' | string) {
  return formatPrice(amount, currency === 'IRT' ? 'تومان' : 'ریال');
}
