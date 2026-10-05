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

test('national ID is optional today and required for dated bank transfers and checks', () => {
  for (const method of ['BANK_TRANSFER', 'CHECK'] as const) {
    const installment = { installmentId: 'payment', dueDate: '2026-09-28', amount: { amount: '100', currency: 'IRT' as const },
      method, ...(method === 'CHECK' ? { check: { dueDate: '2026-09-28', ownerName: 'صاحب چک', handoverDate: '2026-09-28' } } : {}) };
    assert.equal(validatePartnerPaymentInstallment(installment, '2026-09-28').nationalCode, undefined);
    assert.match(validatePartnerPaymentInstallment(installment, '2026-09-27').nationalCode!, /الزامی/);
    assert.equal(validatePartnerPaymentInstallment({ ...installment, nationalCode: '0012345678' }, '2026-09-27').nationalCode, undefined);
  }
});

test('same Tehran payment day accepts Gregorian or Persian display digits consistently', () => {
  const installment = { installmentId: 'today', dueDate: '۱۴۰۵/۰۷/۰۶',
    amount: { amount: '100', currency: 'IRT' as const }, method: 'BANK_TRANSFER' as const };
  assert.equal(validatePartnerPaymentInstallment(installment, '2026-09-28').nationalCode, undefined);
});

test('6 Aban is a future payment, while 6 Mehr in either numeral set is today', () => {
  const amount = { amount: '500000000', currency: 'IRT' as const };
  for (const dueDate of ['2026-09-28', '۲۰۲۶-۰۹-۲۸', '۱۴۰۵/۰۷/۰۶', '١٤٠٥/٠٧/٠٦']) {
    assert.equal(validatePartnerPaymentInstallment({ installmentId: 'same-day', dueDate, amount,
      method: 'BANK_TRANSFER' }, '2026-09-28').nationalCode, undefined);
  }
  assert.match(validatePartnerPaymentInstallment({ installmentId: 'future', dueDate: '2026-10-28', amount,
    method: 'BANK_TRANSFER' }, '2026-09-28').nationalCode!, /الزامی/);
});


test('an unchanged saved payment stays valid as the calendar advances; changed or new payments require ID', () => {
  const saved = { installmentId: 'saved-cash', dueDate: '2026-10-03', method: 'BANK_TRANSFER' as const,
    amount: { amount: '454005000', currency: 'IRT' as const } };
  assert.deepEqual(validatePartnerPaymentInstallment(saved, '2026-10-05', true, saved), {});
  assert.match(validatePartnerPaymentInstallment({ ...saved, dueDate: '2026-10-04' }, '2026-10-05', true, saved).nationalCode!, /الزامی/);
  assert.match(validatePartnerPaymentInstallment({ ...saved, amount: { ...saved.amount, amount: '10' } }, '2026-10-05', true, saved).nationalCode!, /الزامی/);
  assert.match(validatePartnerPaymentInstallment({ ...saved, method: 'CASH' }, '2026-10-05', true, saved).nationalCode!, /الزامی/);
  assert.match(validatePartnerPaymentInstallment({ ...saved, installmentId: 'new' }, '2026-10-05', true, saved).nationalCode!, /الزامی/);
});
