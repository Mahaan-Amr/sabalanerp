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
