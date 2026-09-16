import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerPaymentChoice, partnerPaymentMethodUpdate } from './partnerPaymentMethodAdapter';

test('Partner payment adapter preserves ordinary customer-facing payment methods', () => {
  assert.equal(partnerPaymentChoice({ method: 'CASH', subtype: 'CARD' }), 'CASH_CARD');
  assert.equal(partnerPaymentChoice({ method: 'BANK_TRANSFER', subtype: 'SHIBA' }), 'CASH_SHIBA');
  assert.equal(partnerPaymentChoice({ method: 'CHECK' }), 'CHECK');
  assert.equal(partnerPaymentChoice({ method: 'CREDIT', subtype: 'CUSTOMER_BALANCE' }), 'CUSTOMER_BALANCE');

  assert.deepEqual(partnerPaymentMethodUpdate('CASH_CARD', '2026-09-20'),
    { method: 'CASH', subtype: 'CARD', check: undefined });
  assert.deepEqual(partnerPaymentMethodUpdate('CASH_SHIBA', '2026-09-20'),
    { method: 'BANK_TRANSFER', subtype: 'SHIBA', check: undefined });
  assert.deepEqual(partnerPaymentMethodUpdate('CUSTOMER_BALANCE', '2026-09-20'),
    { method: 'CREDIT', subtype: 'CUSTOMER_BALANCE', check: undefined });
  assert.deepEqual(partnerPaymentMethodUpdate('CHECK', '2026-09-20'),
    { method: 'CHECK', subtype: undefined, check: { number: '', bank: '', dueDate: '2026-09-20' } });
});
