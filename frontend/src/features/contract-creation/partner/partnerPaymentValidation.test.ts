import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePartnerPaymentInstallment } from './partnerPaymentValidation';

test('Partner check validation matches ordinary owner, handover, due-date and dated payer requirements', () => {
  const errors = validatePartnerPaymentInstallment({ installmentId: 'installment-1', dueDate: '2026-09-17',
    amount: { amount: '100', currency: 'IRT' }, method: 'CHECK',
    check: { number: '', bank: '', dueDate: '2026-09-17' } }, '2026-09-16');
  assert.deepEqual(errors, {
    ownerName: 'نام صاحب چک الزامی است.',
    handoverDate: 'تاریخ تحویل چک الزامی است.', nationalCode: 'کد ملی برای پرداخت با تاریخ غیر از امروز الزامی است.',
  });
});

test('Partner payment validation rejects a customer balance installment', () => {
  const installment = { installmentId: 'installment-2', dueDate: '2026-09-16',
    amount: { amount: '100', currency: 'IRT' as const }, method: 'CREDIT' as const, subtype: 'CUSTOMER_BALANCE' as const };
  const errors = validatePartnerPaymentInstallment(installment, '2026-09-16');
  assert.match(errors.amount ?? '', /غیرفعال است/);
  assert.deepEqual(validatePartnerPaymentInstallment(installment, '2026-09-16', true), {});
});
