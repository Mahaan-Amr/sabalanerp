import type { CustomerPaymentPlan } from '@sabalanerp/partner-sales-contracts';
import type { PaymentEntry } from '../types/contract.types';
import { partnerPaymentChoice, partnerPaymentMethodUpdate } from './partnerPaymentMethodAdapter';

type PartnerInstallment = CustomerPaymentPlan['installments'][number];

export function paymentEntryFromPartnerInstallment(installment: PartnerInstallment): PaymentEntry {
  return {
    id: installment.installmentId,
    method: partnerPaymentChoice(installment),
    amount: Number(installment.amount.amount),
    paymentDate: installment.dueDate,
    ...(installment.nationalCode ? { nationalCode: installment.nationalCode } : {}),
    ...(installment.check?.number ? { checkNumber: installment.check.number } : {}),
    ...(installment.check?.ownerName ? { checkOwnerName: installment.check.ownerName } : {}),
    ...(installment.check?.handoverDate ? { handoverDate: installment.check.handoverDate } : {}),
  };
}

export function partnerInstallmentFromPaymentEntry(
  current: PartnerInstallment,
  entry: PaymentEntry,
): PartnerInstallment {
  const method = partnerPaymentMethodUpdate(entry.method, entry.paymentDate);
  return {
    ...current,
    ...method,
    installmentId: current.installmentId,
    dueDate: entry.paymentDate,
    amount: { amount: String(entry.amount), currency: current.amount.currency },
    nationalCode: entry.nationalCode || undefined,
    ...(entry.method === 'CHECK' ? {
      check: {
        number: entry.checkNumber ?? '',
        bank: current.check?.bank ?? '',
        dueDate: entry.paymentDate,
        ownerName: entry.checkOwnerName ?? '',
        handoverDate: entry.handoverDate ?? '',
      },
    } : {}),
  };
}
