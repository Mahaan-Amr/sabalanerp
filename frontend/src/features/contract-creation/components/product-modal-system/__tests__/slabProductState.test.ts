import assert from 'node:assert/strict';
import {
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';
import {
  commitSlabDecimal,
  createEmptySlabDraft,
  createSlabSourceRow,
  firstSlabValidationTarget,
  removeSlabSourceRow,
  replaceSlabSourceRow,
  setSlabCuttingPricingMethod
} from '../slabProductState';

const draft = createEmptySlabDraft({
  calculationPolicyVersion: 'calculation-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  sourceBatchId: parseStableIdentity('source-batch', 'slab-draft'),
  kerfMeters: parseCanonicalDecimal('0.003')
});

assert.equal(draft.cuttingPricingMethod, 'lineBased');
assert.equal(draft.lengthMeters, undefined);
assert.equal(draft.widthMeters, undefined);
assert.equal(draft.quantity, undefined);
assert.equal('cadDesign' in draft, false);
assert.equal(firstSlabValidationTarget(draft), 'geometry');

const geometry = commitSlabDecimal(
  commitSlabDecimal(
    commitSlabDecimal(draft, 'lengthMeters', '1', 'length'),
    'areaSquareMeters',
    '4',
    'area'
  ),
  'baseMaterialRateToman',
  '100'
);
const withQuantity = { ...geometry, quantity: 4 };
assert.equal(withQuantity.lastManualField, 'area');

const first = createSlabSourceRow({
  sourceRowId: parseStableIdentity('slab-source-row', 'source-first')
});
const second = createSlabSourceRow({
  sourceRowId: parseStableIdentity('slab-source-row', 'source-second')
});
const rows = [first, second] as const;
const replaced = replaceSlabSourceRow(rows, first.sourceRowId, row => ({
  ...row,
  lengthMeters: parseCanonicalDecimal('2'),
  widthMeters: parseCanonicalDecimal('2'),
  quantity: 2
}));
assert.deepEqual(replaced.map(row => row.sourceRowId), [
  first.sourceRowId,
  second.sourceRowId
]);
assert.equal(replaced[0]?.quantity, 2);
assert.deepEqual(
  removeSlabSourceRow(replaced, first.sourceRowId).map(row => row.sourceRowId),
  [second.sourceRowId]
);

const withSources = { ...withQuantity, sourceRows: replaced };
assert.equal(firstSlabValidationTarget(withSources), undefined);
const squareMeter = {
  ...setSlabCuttingPricingMethod(withSources, 'squareMeter'),
  squareMeterCutRateToman: parseCanonicalDecimal('25')
};
const lineBased = setSlabCuttingPricingMethod(squareMeter, 'lineBased');
assert.equal(lineBased.squareMeterCutRateToman, '25');
assert.equal(
  setSlabCuttingPricingMethod(lineBased, 'squareMeter').squareMeterCutRateToman,
  '25'
);

console.log('slab product modal state tests passed');

