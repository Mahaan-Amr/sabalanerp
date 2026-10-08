import assert from 'node:assert/strict';
import test from 'node:test';
import { contractDiscountInputError, contractDiscountSnapshotError, enterContractDiscount } from './contractDiscountEdit';

const oldBase = 1_339_716_200;
const newBase = 1_289_716_200;
const discount = { enabled: true, amount: 495_940, percent: 0.037018287903, baseSubtotal: oldBase, maxDiscountPercent: 3 };

test('price correction cannot save the old discount even when its amount remains under the cap', () => {
  assert.match(contractDiscountSnapshotError(discount, newBase) || '', /مبلغ اقلام.*تغییر.*مبلغ یا درصد تخفیف.*دوباره/);
  assert.equal(contractDiscountSnapshotError(discount, oldBase), null);
  assert.equal(discount.amount, 495_940);
  assert.equal(discount.percent, 0.037018287903);
});

test('explicit amount or percentage entry binds the discount to that base only', () => {
  for (const mode of ['AMOUNT_TOMAN', 'PERCENT'] as const) {
    const entry = enterContractDiscount(mode, mode === 'AMOUNT_TOMAN' ? 495_940 : 1, newBase);
    assert.equal(contractDiscountInputError({ ...entry, baseSubtotal: newBase, maxPercent: 3, hasRange: true }), null);
    assert.match(contractDiscountInputError({ ...entry, baseSubtotal: newBase - 1, maxPercent: 3, hasRange: true }) || '', /دوباره/);
  }
});

test('excessive user input is preserved and rejected instead of clamped', () => {
  for (const mode of ['AMOUNT_TOMAN', 'PERCENT'] as const) {
    const entry = enterContractDiscount(mode, mode === 'AMOUNT_TOMAN' ? 50_000_000 : 4, newBase);
    assert.equal(mode === 'AMOUNT_TOMAN' ? entry.amount : entry.percentInput, mode === 'AMOUNT_TOMAN' ? 50_000_000 : 4);
    assert.match(contractDiscountInputError({ ...entry, baseSubtotal: newBase, maxPercent: 3, hasRange: true }) || '', /سقف مجاز/);
  }
});

test('historical valid discounts do not adopt a changed range, but fresh input requires a range', () => {
  assert.equal(contractDiscountSnapshotError(discount, oldBase), null);
  const entry = enterContractDiscount('AMOUNT_TOMAN', 100, newBase);
  assert.match(contractDiscountInputError({ ...entry, baseSubtotal: newBase, maxPercent: 0, hasRange: false }) || '', /بازه تخفیف/);
  assert.equal(contractDiscountSnapshotError(null, newBase), null);
});

test('unchanged historical percentage discounts retain their fractional toman interpretation', () => {
  const legacy = { enabled: true, baseSubtotal: 1001, amount: 30.03, percent: 3, maxDiscountPercent: 3 };
  assert.equal(contractDiscountSnapshotError(legacy, 1001), null);
  assert.match(contractDiscountSnapshotError(legacy, 1000) || '', /دوباره/);
  assert.notEqual(contractDiscountSnapshotError({ ...legacy, inputMode: 'AMOUNT_TOMAN' }, 1001), null);
});
