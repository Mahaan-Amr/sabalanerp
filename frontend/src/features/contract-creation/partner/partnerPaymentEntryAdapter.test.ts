import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentEntryFromPartnerInstallment, partnerInstallmentFromPaymentEntry } from './partnerPaymentEntryAdapter';

test('maps a partner check installment into the shared sales payment form', () => {
  assert.deepEqual(paymentEntryFromPartnerInstallment({
    installmentId: 'installment-1',
    dueDate: '2026-09-30',
    amount: { amount: '1250000', currency: 'IRT' },
    method: 'CHECK',
    nationalCode: '0012345678',
    check: { number: '42', bank: '', dueDate: '2026-09-30', ownerName: 'رضا', handoverDate: '2026-09-22' },
  }), {
    id: 'installment-1',
    method: 'CHECK',
    amount: 1250000,
    paymentDate: '2026-09-30',
    nationalCode: '0012345678',
    checkNumber: '42',
    checkOwnerName: 'رضا',
    handoverDate: '2026-09-22',
  });
});

test('maps the shared sales payment form back without losing partner identity or currency', () => {
  const current = {
    installmentId: 'installment-1',
    dueDate: '2026-09-30',
    amount: { amount: '1250000', currency: 'IRT' as const },
    method: 'BANK_TRANSFER' as const,
    subtype: 'SHIBA',
  };
  assert.deepEqual(partnerInstallmentFromPaymentEntry(current, {
    id: 'installment-1', method: 'CASH_CARD', amount: 800000, paymentDate: '2026-10-01',
  }), {
    installmentId: 'installment-1',
    dueDate: '2026-10-01',
    amount: { amount: '800000', currency: 'IRT' },
    method: 'CASH',
    subtype: 'CARD',
    check: undefined,
    nationalCode: undefined,
  });
});
