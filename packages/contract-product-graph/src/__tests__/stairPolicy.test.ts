import assert from 'node:assert/strict';
import {
  calculateStairPart,
  createNewStairPartPolicyInput
} from '../stairPolicy';
import { parseCanonicalDecimal } from '../canonicalDecimal';
import { parseStableIdentity } from '../stableIdentity';

const decimal = parseCanonicalDecimal;
const versions = {
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
};

const stairInput = (motherLengthMeters?: string) => ({
  ...createNewStairPartPolicyInput(
    'tread',
    {
      stairSystemId: parseStableIdentity('stair-system', 'stair-derived-source'),
      sourceBatchId: parseStableIdentity('source-batch', 'stair-derived-batch')
    },
    versions
  ),
  ...(motherLengthMeters === undefined
    ? {}
    : { motherLengthMeters: decimal(motherLengthMeters) }),
  motherWidthMeters: decimal('0.4'),
  lengthMeters: decimal('1.2'),
  crossDimensionMeters: decimal('0.3'),
  quantity: 4,
  baseRateToman: decimal('100000'),
  longitudinalCutRateToman: decimal('0'),
  crossCutRateToman: decimal('0'),
  calibrationCutRateToman: decimal('0')
});

{
  const calculated = calculateStairPart(stairInput());
  assert.equal(calculated.ok, true, JSON.stringify(calculated));
  if (!calculated.ok) throw new Error('Expected derived mother length to be valid.');
  assert.equal(calculated.result.motherLengthMode, 'derived-from-finished');
  assert.equal(calculated.result.motherLengthMeters, '1.2');
  assert.equal(calculated.result.requestedAreaSquareMeters, '1.44');
  assert.equal(calculated.result.consumedMotherAreaSquareMeters, '1.92');
  assert.equal(calculated.result.paidRemainderAreaSquareMeters, '0.48');
  assert.equal(calculated.result.baseAmountToman, '192000');
  assert.equal(calculated.result.packingPlan.consumedSources.length, 4);
}

{
  const calculated = calculateStairPart(stairInput('1.5'));
  assert.equal(calculated.ok, true, JSON.stringify(calculated));
  if (!calculated.ok) throw new Error('Expected explicit mother length to be valid.');
  assert.equal(calculated.result.motherLengthMode, 'explicit');
  assert.equal(calculated.result.motherLengthMeters, '1.5');
  assert.equal(calculated.result.requestedAreaSquareMeters, '1.44');
  assert.equal(calculated.result.consumedMotherAreaSquareMeters, '2.4');
  assert.equal(calculated.result.paidRemainderAreaSquareMeters, '0.96');
  assert.equal(calculated.result.baseAmountToman, '240000');
  assert.equal(calculated.result.packingPlan.consumedSources.length, 4);
}

console.log('stair policy tests passed');
