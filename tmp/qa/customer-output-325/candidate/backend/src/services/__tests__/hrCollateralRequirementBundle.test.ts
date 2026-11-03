import assert from 'node:assert/strict';
import { normalizeCollateralRequirementLines } from '../hrHiringRules';

const rows = normalizeCollateralRequirementLines([
  { lineKey: 'a', type: 'PROMISSORY_NOTE', amountRials: '1000000' },
  { lineKey: 'b', type: 'GUARANTEE', amountRials: '' },
  { lineKey: 'c', type: 'OTHER', customTitle: 'گواهی سپرده', amountRials: null },
]);
assert.deepEqual(rows.map(({ lineKey, sortOrder, type, amountRials, customTitle }) => ({ lineKey, sortOrder, type, amountRials, customTitle })), [
  { lineKey: 'a', sortOrder: 0, type: 'PROMISSORY_NOTE', amountRials: '1000000', customTitle: null },
  { lineKey: 'b', sortOrder: 1, type: 'GUARANTEE', amountRials: null, customTitle: null },
  { lineKey: 'c', sortOrder: 2, type: 'OTHER', amountRials: null, customTitle: 'گواهی سپرده' },
]);

assert.throws(() => normalizeCollateralRequirementLines([]), /حداقل یک ردیف/);
assert.throws(() => normalizeCollateralRequirementLines([
  { lineKey: 'a', type: 'CHEQUE', amountRials: '' },
]), /مبلغ مثبت/);
assert.throws(() => normalizeCollateralRequirementLines([
  { lineKey: 'a', type: 'OTHER', customTitle: '  ' },
]), /عنوان اختصاصی/);
assert.throws(() => normalizeCollateralRequirementLines([
  { lineKey: 'same', type: 'GUARANTEE' },
  { lineKey: 'same', type: 'UNDERTAKING' },
]), /شناسه ردیف/);

console.log('hr collateral requirement bundle tests passed');
