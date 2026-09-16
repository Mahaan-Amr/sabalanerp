import type { PaymentEntryMethod } from '../types/contract.types';

type PartnerInstallmentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CREDIT';

export function partnerPaymentChoice(installment: { method: PartnerInstallmentMethod; subtype?: string }): PaymentEntryMethod {
  if (installment.method === 'CHECK') return 'CHECK';
  if (installment.method === 'CREDIT' && installment.subtype === 'CUSTOMER_BALANCE') return 'CUSTOMER_BALANCE';
  if (installment.method === 'BANK_TRANSFER') return 'CASH_SHIBA';
  return 'CASH_CARD';
}

export function partnerPaymentMethodUpdate(choice: PaymentEntryMethod, dueDate: string) {
  if (choice === 'CHECK') return { method: 'CHECK' as const, subtype: undefined,
    check: { number: '', bank: '', dueDate } };
  if (choice === 'CUSTOMER_BALANCE') return { method: 'CREDIT' as const,
    subtype: 'CUSTOMER_BALANCE', check: undefined };
  if (choice === 'CASH_SHIBA') return { method: 'BANK_TRANSFER' as const,
    subtype: 'SHIBA', check: undefined };
  return { method: 'CASH' as const, subtype: 'CARD', check: undefined };
}
