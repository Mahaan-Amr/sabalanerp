import assert from 'node:assert/strict';
import {
  calculateSlab,
  parseCanonicalDecimal,
  parseStableIdentity,
  type SlabPolicyInput
} from '../index';

const decimal = parseCanonicalDecimal;
const base = (
  overrides: Partial<SlabPolicyInput> = {}
): SlabPolicyInput => ({
  calculationPolicyVersion: 'calc-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  sourceBatchId: parseStableIdentity('source-batch', 'slab-batch-1'),
  lengthMeters: decimal('1'),
  widthMeters: decimal('1'),
  quantity: 4,
  lastManualField: 'width',
  lastManualDimension: 'width',
  lengthDisplayUnit: 'm',
  widthDisplayUnit: 'm',
  sourceRows: [{
    sourceRowId: parseStableIdentity('slab-source-row', 'slab-source-1'),
    lengthMeters: decimal('2'),
    widthMeters: decimal('2'),
    lengthDisplayUnit: 'm',
    widthDisplayUnit: 'm',
    quantity: 2
  }],
  baseMaterialRateToman: decimal('100'),
  kerfMeters: decimal('0'),
  cuttingPricingMethod: 'lineBased',
  longitudinalCutRateToman: decimal('10'),
  crossCutRateToman: decimal('10'),
  verticalCutSides: [],
  ...overrides
});

{
  const result = calculateSlab(base());
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected canonical slab calculation.');
  assert.equal(result.result.finishedAreaSquareMeters, '4');
  assert.equal(result.result.packingPlan.consumedSources.length, 1);
  assert.deepEqual(result.result.packingPlan.unusedSources, [{
    sourceBatchId: parseStableIdentity(
      'source-batch',
      'slab-batch-1:slab-source-1'
    ),
    quantity: 1
  }]);
  assert.equal(result.result.materialAreaSquareMeters, '4');
  assert.equal(result.result.materialAmountToman, '400');
  assert.ok(result.result.packingPlan.remainders.length >= 0);
}

{
  const derived = calculateSlab(base({
    widthMeters: undefined,
    areaSquareMeters: decimal('4')
  }));
  assert.equal(derived.ok, true, JSON.stringify(derived));
  if (!derived.ok) throw new Error('Expected length plus area to derive width.');
  assert.equal(derived.result.widthMeters, '1');

  const areaAuthoritative = calculateSlab(base({
    lengthMeters: decimal('1'),
    widthMeters: decimal('1'),
    areaSquareMeters: decimal('8'),
    lastManualField: 'area',
    lastManualDimension: 'length'
  }));
  assert.equal(areaAuthoritative.ok, true, JSON.stringify(areaAuthoritative));
  if (!areaAuthoritative.ok) throw new Error('Expected area authority.');
  assert.equal(areaAuthoritative.result.widthMeters, '2');
}

{
  const lineBased = calculateSlab(base());
  const squareMeter = calculateSlab(base({
    cuttingPricingMethod: 'squareMeter',
    squareMeterCutRateToman: decimal('25')
  }));
  assert.equal(lineBased.ok, true);
  assert.equal(squareMeter.ok, true);
  if (!lineBased.ok || !squareMeter.ok) throw new Error('Expected both methods.');
  assert.deepEqual(
    squareMeter.result.packingPlan,
    lineBased.result.packingPlan
  );
  assert.equal(squareMeter.result.cuttingPricingLines[0]?.quantity, '4');
  assert.equal(squareMeter.result.cuttingAmountToman, '100');

  const missingRate = calculateSlab(base({
    cuttingPricingMethod: 'squareMeter',
    squareMeterCutRateToman: decimal('0')
  }));
  assert.equal(missingRate.ok, false);
  if (missingRate.ok) throw new Error('Expected square-meter rate validation.');
  assert.equal(missingRate.conflicts[0]?.field, 'squareMeterCutRateToman');
}

{
  const insufficient = calculateSlab(base({
    quantity: 5,
    sourceRows: [{
      ...base().sourceRows[0],
      quantity: 1
    }]
  }));
  assert.equal(insufficient.ok, false);
  if (insufficient.ok) throw new Error('Expected explicit source shortage.');
  assert.equal(insufficient.conflicts[0]?.code, 'slab-source-insufficient');
}

{
  const invalid = calculateSlab(base({
    sourceRows: [{
      ...base().sourceRows[0],
      quantity: 0
    }]
  }));
  assert.equal(invalid.ok, false);
  if (invalid.ok) throw new Error('Expected invalid manual source values.');
  assert.equal(invalid.conflicts[0]?.code, 'invalid-slab-input');
  assert.equal(invalid.conflicts[0]?.field, 'sourceRows');
}

{
  const source = base().sourceRows[0];
  const duplicate = calculateSlab(base({
    sourceRows: [source, source]
  }));
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) throw new Error('Expected duplicate manual source identity.');
  assert.equal(duplicate.conflicts[0]?.code, 'duplicate-slab-source');
}

console.log('slab policy tests passed');
