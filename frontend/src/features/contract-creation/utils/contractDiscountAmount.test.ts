import assert from 'node:assert/strict';
import test from 'node:test';
import { clampContractDiscountToman, contractDiscountDisplayPercent, contractDiscountEquivalentPercent, contractDiscountTomanFromPercent, maximumContractDiscountToman } from './contractDiscountAmount';

test('manager percentage range yields a whole-toman cap and exact entered amount', () => {
  const base = 87_596_923;
  const cap = maximumContractDiscountToman(base, 4.5);
  assert.equal(cap, 3_941_861);
  assert.equal(clampContractDiscountToman(4_000_000, cap), cap);
  assert.equal(clampContractDiscountToman(3_000_000, cap), 3_000_000);
  assert.equal(contractDiscountTomanFromPercent(base, 4.5, cap), cap);
  assert.equal(contractDiscountTomanFromPercent(base, 3, cap), 2_627_908);
  assert.equal(contractDiscountDisplayPercent(3_000_000, base), 3.42);
  assert.equal(Math.round(base * contractDiscountEquivalentPercent(3_000_000, base) / 100), 3_000_000);
  assert.equal(maximumContractDiscountToman(base, 0), 0);
});
