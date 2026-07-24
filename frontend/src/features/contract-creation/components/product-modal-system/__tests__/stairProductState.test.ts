import assert from 'node:assert/strict';
import {
  applyStaircaseQuantityIntent,
  editStairPartQuantity,
  toStaircaseQuantityIntent,
  type StairQuantityState
} from '../StairProductSection';
import {
  createNewStairPartPolicyInput,
  copyStairPartOperations,
  copyStairPartPolicyFromTread,
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';

const initial: StairQuantityState = {
  intent: { mode: 'steps', totalSteps: 1 },
  tread: { value: null, manuallyEdited: false },
  riser: { value: null, manuallyEdited: false },
  landing: { value: null, manuallyEdited: false }
};
const initialized = applyStaircaseQuantityIntent(initial, {
  mode: 'staircases',
  numberOfStaircases: 2,
  stepsPerStaircase: 15
});
assert.equal(initial.tread.value, null);
assert.equal(initialized.tread.value, 30);
assert.equal(initialized.riser.value, 30);
assert.equal(initialized.landing.value, null);

const manuallyChanged = editStairPartQuantity(initialized, 'riser', 28);
const quantityChanged = applyStaircaseQuantityIntent(manuallyChanged, {
  mode: 'steps',
  totalSteps: 32
});
assert.equal(quantityChanged.tread.value, 32);
assert.equal(quantityChanged.riser.value, 28);
assert.equal(quantityChanged.landing.value, null);

assert.deepEqual(
  toStaircaseQuantityIntent({
    mode: 'staircases',
    totalSteps: '',
    numberOfStaircases: '۲',
    stepsPerStaircase: '١٥'
  }),
  {
    mode: 'staircases',
    numberOfStaircases: 2,
    stepsPerStaircase: 15
  }
);

const versions = {
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
};
const stairSystemId = parseStableIdentity('stair-system', 'copy-system');
const tread = createNewStairPartPolicyInput(
  'tread',
  {
    stairSystemId,
    sourceBatchId: parseStableIdentity('source-batch', 'copy-tread-source')
  },
  versions
);
const riser = createNewStairPartPolicyInput(
  'riser',
  {
    stairSystemId,
    sourceBatchId: parseStableIdentity('source-batch', 'copy-riser-source')
  },
  versions
);
assert.equal(tread.crossDimensionMeters, '0.3');
assert.equal(riser.crossDimensionMeters, '0.17');
const copied = copyStairPartPolicyFromTread({
  tread: {
    ...tread,
    lengthMeters: parseCanonicalDecimal('1.2'),
    baseRateToman: parseCanonicalDecimal('5000')
  },
  target: riser
});
assert.equal(copied.part, 'riser');
assert.equal(copied.sourceBatchId, 'copy-riser-source');
assert.equal(copied.lengthMeters, '1.2');
assert.equal(copied.baseRateToman, '5000');
assert.equal(riser.lengthMeters, undefined);

const sourceGroupId = parseStableIdentity('operation-group', 'copy-source-group');
const copiedOperations = copyStairPartOperations({
  source: {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: parseStableIdentity('product-row', 'copy-source-row'),
    lengthMeters: parseCanonicalDecimal('1.2'),
    widthMeters: parseCanonicalDecimal('0.3'),
    quantity: 10,
    groups: [{
      operationGroupId: sourceGroupId,
      scope: parseCanonicalDecimal('10')
    }],
    tools: [{
      toolSelectionId: parseStableIdentity('tool-selection', 'copy-source-tool'),
      operationGroupId: sourceGroupId,
      catalogItemId: 'tool-1',
      catalogSnapshotVersion: 'tool-v1',
      name: 'Edge',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('100'),
      edges: ['front']
    }],
    finishings: []
  },
  targetProductRowId: parseStableIdentity('product-row', 'copy-target-row'),
  lengthMeters: parseCanonicalDecimal('1.5'),
  crossDimensionMeters: parseCanonicalDecimal('0.17'),
  quantity: 10,
  operationGroupIdentity: () =>
    parseStableIdentity('operation-group', 'copy-target-group'),
  toolSelectionIdentity: () =>
    parseStableIdentity('tool-selection', 'copy-target-tool'),
  finishingSelectionIdentity: () =>
    parseStableIdentity('finishing-selection', 'copy-target-finishing')
});
assert.equal(copiedOperations.productRowId, 'copy-target-row');
assert.equal(copiedOperations.lengthMeters, '1.5');
assert.equal(copiedOperations.quantity, 10);
assert.equal(copiedOperations.groups[0]?.operationGroupId, 'copy-target-group');
assert.equal(copiedOperations.tools[0]?.toolSelectionId, 'copy-target-tool');
assert.equal(copiedOperations.tools[0]?.rateToman, '100');
assert.notEqual(
  copiedOperations.tools[0]?.toolSelectionId,
  'copy-source-tool'
);

console.log('stair product state tests passed');
