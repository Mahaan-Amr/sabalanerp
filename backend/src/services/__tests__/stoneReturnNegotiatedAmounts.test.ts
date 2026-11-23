import assert from 'node:assert/strict';
import test from 'node:test';
import { apportionStoneReturnCredit } from '../stoneReturnNegotiatedAmounts';

test('partitions one whole-rial negotiated amount over invoices without independently rounding each share', () => {
  const result = apportionStoneReturnCredit('1', ['0.500', '0.500', '0.500']);
  assert.deepEqual(result, { agreedRials: 2n, invoiceCredits: [1n, 0n, 1n] });
});
