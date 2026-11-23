import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStoneReturnRate } from './stoneReturnRate';

test('uses the exact original net rate when deciding whether a reason is required', () => {
  const source = { originalInvoicedQuantity: '3.000', originalLineNetRials: '10' };
  assert.deepEqual(describeStoneReturnRate('۳٫۳۳۳۳۳۳۳۳', '3', [source]), {
    agreedUnitRateRials: '3.33333333', customerCreditRials: '10', requiresReason: true,
  });
  assert.deepEqual(describeStoneReturnRate('۱۲٬۵۰۰٫۵', '2', [{
    originalInvoicedQuantity: '2.000', originalLineNetRials: '25001',
  }]), { agreedUnitRateRials: '12500.5', customerCreditRials: '25001', requiresReason: false });
});
