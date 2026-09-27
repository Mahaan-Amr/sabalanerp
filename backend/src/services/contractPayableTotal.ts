import { Prisma } from '@prisma/client';

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

export const assertContractPayableTotal = (
  productTotal: string,
  contractData: unknown,
  submittedTotal: unknown,
): Prisma.Decimal => {
  const data = contractData && typeof contractData === 'object' && !Array.isArray(contractData)
    ? contractData as Record<string, unknown> : {};
  const services = data.serviceRows == null ? [] : data.serviceRows;
  if (!Array.isArray(services)) throw new ContractPayableTotalError('service rows', String(services), 'serviceRows');
  const serviceTotal = services.reduce<Prisma.Decimal>((sum, row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ContractPayableTotalError('valid service row', String(row), `serviceRows.${index}`);
    }
    return sum.plus(decimal((row as Record<string, unknown>).totalPrice, `serviceRows.${index}.totalPrice`));
  }, new Prisma.Decimal(0));
  const discount = data.discount && typeof data.discount === 'object' && !Array.isArray(data.discount)
    ? data.discount as Record<string, unknown> : null;
  const discountAmount = discount?.amount == null ? new Prisma.Decimal(0)
    : decimal(discount.amount, 'discount.amount');
  const expected = Prisma.Decimal.max(new Prisma.Decimal(productTotal).plus(serviceTotal).minus(discountAmount), 0);
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
