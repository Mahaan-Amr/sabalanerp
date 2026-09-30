import { Prisma } from '@prisma/client';
import { roundContractPayableTotal, sumContractMonetaryAmounts, verifyContractMonetaryRounding } from '@sabalanerp/contract-product-graph';

export class ContractPayableTotalError extends Error {
  readonly code = 'contract-payable-total-mismatch';

  constructor(readonly expected: string, readonly received: string, readonly field: string) {
    super('مبلغ قرارداد با جمع ردیف‌ها، خدمات و تخفیف هم‌خوانی ندارد؛ برنامه پرداخت را بازبینی کنید.');
    this.name = 'ContractPayableTotalError';
  }
}

const decimal = (value: unknown, field: string): Prisma.Decimal => {
  if (value === null || value === undefined || value === '') {
    throw new ContractPayableTotalError('valid amount', String(value), field);
  }
  try {
    const amount = new Prisma.Decimal(String(value));
    if (!amount.isFinite() || amount.isNegative()) throw new Error('invalid amount');
    return amount;
  } catch {
    throw new ContractPayableTotalError('valid amount', String(value), field);
  }
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

const contractPayableSource = (productTotal: string, data: Record<string, unknown>): string => {
  const services = data.serviceRows ?? [];
  if (!Array.isArray(services)) throw new ContractPayableTotalError('service rows', String(services), 'serviceRows');
  const amounts = services.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ContractPayableTotalError('valid service row', String(row), `serviceRows.${index}`);
    }
    return decimal(record(row).totalPrice, `serviceRows.${index}.totalPrice`).toString();
  });
  const discount = decimal(record(data.discount).amount ?? 0, 'discount.amount').toString();
  const source = sumContractMonetaryAmounts([decimal(productTotal, 'productTotal').toString(), ...amounts, `-${discount}`]);
  return source.startsWith('-') ? '0' : source;
};

export const assertContractPayableTotal = (
  productTotal: string,
  contractData: unknown,
  submittedTotal: unknown,
): Prisma.Decimal => {
  const data = record(contractData);
  const raw = contractPayableSource(productTotal, data);
  const currency = record(data.payment).currency;
  let expected = new Prisma.Decimal(raw);
  if (data.monetaryRounding !== undefined) {
    try { expected = new Prisma.Decimal(verifyContractMonetaryRounding(raw, String(currency ?? ''), data.monetaryRounding)); }
    catch { throw new ContractPayableTotalError('valid rounding evidence', String(data.monetaryRounding), 'monetaryRounding'); }
  }
  const submitted = decimal(submittedTotal, 'totalAmount');
  if (!submitted.eq(expected)) {
    throw new ContractPayableTotalError(expected.toString(), submitted.toString(), 'totalAmount');
  }
  const payment = data.payment && typeof data.payment === 'object' && !Array.isArray(data.payment)
    ? data.payment as Record<string, unknown> : null;
  if (payment?.totalContractAmount !== null && payment?.totalContractAmount !== undefined) {
    const paymentTotal = decimal(payment.totalContractAmount, 'payment.totalContractAmount');
    if (!paymentTotal.eq(expected)) {
      throw new ContractPayableTotalError(expected.toString(), paymentTotal.toString(), 'payment.totalContractAmount');
    }
  }
  return expected;
};

/** New/draft writes seal the actual obligation; historical reads never call this. */
export const sealContractPayableTotal = (productTotal: string, contractData: Record<string, unknown>,
  submittedTotal: unknown, currency: string) => {
  const monetaryRounding = roundContractPayableTotal(contractPayableSource(productTotal, contractData), currency);
  // Existing clients may supply the precise total. Only that exact source or its
  // deterministic rounded obligation is accepted, never an arbitrary difference.
  const submitted = decimal(submittedTotal, 'totalAmount');
  if (!submitted.eq(monetaryRounding.sourceAmount) && !submitted.eq(monetaryRounding.roundedAmount)) {
    throw new ContractPayableTotalError(monetaryRounding.roundedAmount, submitted.toString(), 'totalAmount');
  }
  const paymentTotal = record(contractData.payment).totalContractAmount;
  if (paymentTotal != null && !decimal(paymentTotal, 'payment.totalContractAmount').eq(monetaryRounding.sourceAmount) &&
    !decimal(paymentTotal, 'payment.totalContractAmount').eq(monetaryRounding.roundedAmount)) {
    throw new ContractPayableTotalError(monetaryRounding.roundedAmount, String(paymentTotal), 'payment.totalContractAmount');
  }
  const normalized = { ...contractData, monetaryRounding,
    payment: { ...record(contractData.payment), currency, totalContractAmount: Number(monetaryRounding.roundedAmount) } };
  assertContractPayableTotal(productTotal, normalized, monetaryRounding.roundedAmount);
  return { contractData: normalized, totalAmount: new Prisma.Decimal(monetaryRounding.roundedAmount) };
};
