import { toFiniteNumber } from '@/lib/numberFormat';

type PaymentLike = Record<string, unknown>;

export interface ContractPaymentRow {
  id: string;
  methodLabel: string;
  amount: number;
  currency: string;
  paymentDate: string | null;
  handoverDate: string | null;
  checkNumber: string | null;
  checkOwnerName: string | null;
  status: string | null;
  notes: string | null;
}

export interface ContractPaymentPresentation {
  source: 'payments' | 'historical-snapshot' | 'missing';
  summaryLabel: string;
  rows: ContractPaymentRow[];
}

const clean = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const getPaymentStatusLabel = (status: unknown): string | null => {
  const normalized = clean(status)?.toUpperCase();
  if (!normalized) return null;
  if (normalized === 'PENDING') return 'در انتظار پرداخت';
  if (normalized === 'COMPLETED' || normalized === 'PAID') return 'پرداخت‌شده';
  if (normalized === 'FAILED') return 'ناموفق';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'لغوشده';
  return clean(status);
};

export const getContractPaymentMethodLabel = (
  paymentMethod: unknown,
  cashType?: unknown
): string => {
  const method = clean(paymentMethod)?.toUpperCase();
  const cash = clean(cashType)?.toUpperCase();
  if (method === 'CASH_SHIBA' || (method === 'CASH' && cash === 'SHIBA')) return 'نقدی (شبا)';
  if (method === 'CASH_CARD' || (method === 'CASH' && (cash === 'CARD' || cash === 'POS'))) return 'نقدی (کارتخوان)';
  if (method === 'CASH') return 'نقدی';
  if (method === 'CHECK') return 'چک';
  if (method === 'CUSTOMER_BALANCE' || method === 'RECEIPT') return 'استفاده از مانده مشتری';
  return 'روش پرداخت نامشخص';
};

const mapPayment = (payment: PaymentLike, index: number, currency: string): ContractPaymentRow => ({
  id: clean(payment.id) || `payment-${index}`,
  methodLabel: getContractPaymentMethodLabel(
    payment.paymentMethod ?? payment.method,
    payment.cashType
  ),
  amount: toFiniteNumber((payment.totalAmount ?? payment.amount) as number | string | null | undefined),
  currency: clean(payment.currency) || currency,
  paymentDate: clean(payment.paymentDate),
  handoverDate: clean(payment.handoverDate),
  checkNumber: clean(payment.checkNumber),
  checkOwnerName: clean(payment.checkOwnerName),
  status: getPaymentStatusLabel(payment.status),
  notes: clean(payment.notes ?? payment.description)
});

export const buildContractPaymentPresentation = ({
  payments,
  contractData,
  currency
}: {
  payments?: PaymentLike[] | null;
  contractData?: Record<string, any> | null;
  currency: string;
}): ContractPaymentPresentation => {
  const relationalPayments = Array.isArray(payments) ? payments : [];
  const historicalPayments: PaymentLike[] = Array.isArray(contractData?.payment?.payments)
    ? contractData.payment.payments as PaymentLike[]
    : [];
  const source = relationalPayments.length > 0
    ? 'payments'
    : historicalPayments.length > 0
      ? 'historical-snapshot'
      : 'missing';
  const selected = source === 'payments'
    ? relationalPayments
    : source === 'historical-snapshot'
      ? historicalPayments
      : [];
  const rows = selected.map((payment, index) => mapPayment(payment, index, currency));
  return {
    source,
    summaryLabel: rows.length === 0
      ? 'ثبت نشده'
      : rows.length === 1
        ? rows[0].methodLabel
        : `${rows.length.toLocaleString('fa-IR')} روش پرداخت`,
    rows
  };
};
