import assert from 'node:assert/strict';
import test from 'node:test';
import { assertContractDiscountReadyForSave, CONTRACT_DISCOUNT_REENTRY_REQUIRED } from '../contractDiscountSavePolicy';
import { knownContractUpdateBusinessFailure } from '../../utils/salesOperationalError';

const rows = [{ productRowId: 'stone', baseAmountToman: '1000' }, { productRowId: 'layer', baseAmountToman: '500' }];
const data = () => ({ products: [{ rowId: 'stone', meta: { isLayer: false } }, { rowId: 'layer', meta: { isLayer: true } }],
  discount: { enabled: true, inputMode: 'AMOUNT_TOMAN', baseSubtotal: 1000, amount: 10, percent: 1, maxDiscountPercent: 5,
    rangeId: 'historical-range', appliedAt: '2026-10-01T00:00:00Z' } });
const rejects = (value: unknown, canonicalRows = rows) => assert.throws(
  () => assertContractDiscountReadyForSave(value, canonicalRows), { message: CONTRACT_DISCOUNT_REENTRY_REQUIRED });

test('valid saved discount and historical cap remain exactly unchanged, excluding layers', () => {
  const value = data();
  const before = structuredClone(value);
  assertContractDiscountReadyForSave(value, rows);
  assert.deepEqual(value, before);
});
test('changed eligible base rejects both increases and decreases without changing agreed values', () => {
  for (const baseAmountToman of ['950', '1050']) {
    const value = data();
    const before = structuredClone(value);
    rejects(value, [{ ...rows[0], baseAmountToman }, rows[1]]);
    assert.deepEqual(value, before);
  }
});
test('explicit new amount/percent on current base permits save', () => {
  const value = data();
  value.discount.baseSubtotal = 950;
  value.discount.percent = Number((10 * 100 / 950).toFixed(12));
  assertContractDiscountReadyForSave(value, [{ ...rows[0], baseAmountToman: '950' }, rows[1]]);
});
test('legacy percent evidence preserves exact saved interpretation', () => {
  const value = data() as any;
  delete value.discount.inputMode;
  assertContractDiscountReadyForSave(value, rows);
  value.discount.percent = 1.000001;
  rejects(value);
});
test('historical fractional percentage discount retains exact amount even at its saved cap', () => {
  const value = data() as any;
  delete value.discount.inputMode;
  value.discount.baseSubtotal = 999;
  value.discount.amount = 49.95;
  value.discount.percent = 5;
  value.discount.maxDiscountPercent = 5;
  const before = structuredClone(value);
  assertContractDiscountReadyForSave(value, [{ ...rows[0], baseAmountToman: '999' }, rows[1]]);
  assert.deepEqual(value, before);
});
test('incompatible percentage, excessive amount, malformed and unknown modes fail closed', () => {
  for (const discount of [
    { amount: 11 }, { amount: 60, percent: 6 }, { amount: -1 }, { percent: NaN },
    { inputMode: 'PERCENT' }, { amount: 10.5, percent: 1.05 }, { baseSubtotal: Infinity },
  ]) rejects({ ...data(), discount: { ...data().discount, ...discount } });
});
test('no-discount legacy shapes keep existing normalization responsibility', () => {
  for (const discount of [null, undefined, { enabled: false, amount: 0, percent: 0, baseSubtotal: 950 }]) {
    assertContractDiscountReadyForSave({ ...data(), discount }, rows);
  }
});
test('API reports a correctable discount error with actionable Persian instructions', () => {
  assert.deepEqual(knownContractUpdateBusinessFailure(CONTRACT_DISCOUNT_REENTRY_REQUIRED), {
    status: 400, body: { success: false, code: 'SALES_CONTRACT_DISCOUNT_REENTRY_REQUIRED', error: CONTRACT_DISCOUNT_REENTRY_REQUIRED },
  });
});
