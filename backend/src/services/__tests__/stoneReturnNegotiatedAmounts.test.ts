import assert from 'node:assert/strict';
import test from 'node:test';
import { apportionStoneReturnCredit, stoneReturnRatesDiffer } from '../stoneReturnNegotiatedAmounts';

test('partitions one whole-rial negotiated amount over invoices without independently rounding each share', () => {
  const result = apportionStoneReturnCredit('1', ['0.500', '0.500', '0.500']);
  assert.deepEqual(result, { agreedRials: 2n, invoiceCredits: [1n, 0n, 1n] });
});

test('compares a case rate against every exact original net rate', () => {
  const same = { originalInvoicedQuantity: '2.000', originalLineNetRials: '1000' };
  const different = { originalInvoicedQuantity: '2.000', originalLineNetRials: '1001' };
  assert.equal(stoneReturnRatesDiffer('500.000', [same]), false);
  assert.equal(stoneReturnRatesDiffer('500.000', [same, different]), true);
  assert.equal(stoneReturnRatesDiffer('3.33333333', [{ originalInvoicedQuantity: '3.000', originalLineNetRials: '10' }]), true);
});
