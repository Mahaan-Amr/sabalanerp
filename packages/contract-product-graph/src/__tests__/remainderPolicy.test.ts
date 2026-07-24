import assert from 'node:assert/strict';
import {
  canDeleteRemainderSource,
  findRemainderDependents,
  materializePaidRemainderStocks,
  replayRemainderAllocations,
  type PaidRemainderStock,
  type RemainderChildIntent
} from '../remainderPolicy';
import { parseCanonicalDecimal as c } from '../canonicalDecimal';
import { parseStableIdentity as id } from '../stableIdentity';

const sourceRowId = id('product-row', 'source-row');
const otherSourceRowId = id('product-row', 'other-source-row');
const stock = (
  suffix: string,
  overrides: Partial<PaidRemainderStock> = {}
): PaidRemainderStock => ({
  remainingStoneId: id('remaining-stone', `stock-${suffix}`),
  ownerProductRowId: sourceRowId,
  catalogProductId: 'granite-1',
  sourceBatchId: id('source-batch', `source-batch-${suffix}`),
  lengthMeters: c('1.5'),
  widthMeters: c('0.16'),
  quantity: 3,
  creationOrder: 0,
  materialPaid: true,
  ...overrides
});
const child = (
  suffix: string,
  overrides: Partial<RemainderChildIntent> = {}
): RemainderChildIntent => ({
  allocationId: id('allocation', `allocation-${suffix}`),
  allocationOrder: 0,
  childProductRowId: id('product-row', `child-${suffix}`),
  sourceProductRowId: sourceRowId,
  selectedRemainingStoneId: id('remaining-stone', 'stock-main'),
  catalogProductId: 'granite-1',
  lengthMeters: c('1.5'),
  widthMeters: c('0.12'),
  quantity: 2,
  kerfMeters: c('0'),
  calibrationEnabled: false,
  longitudinalCutRateToman: c('0'),
  crossCutRateToman: c('0'),
  calibrationCutRateToman: c('0'),
  ...overrides
});

const exact = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('main')]
});
assert.equal(exact.ok, true);
if (!exact.ok) throw new Error('Expected exact remainder allocation.');
assert.equal(exact.result.allocations[0]?.consumedSourcePieces, 2);
assert.equal(exact.result.allocations[0]?.materialAmountToman, '0');
assert.equal(exact.result.allocations[0]?.cuttingAmountToman, '0');
assert.equal(exact.result.inventory.find(item =>
  item.remainingStoneId === id('remaining-stone', 'stock-main')
)?.quantity, 1);
assert.deepEqual(
  exact.result.inventory
    .filter(item => item.ownerProductRowId === id('product-row', 'child-main'))
    .map(item => [item.lengthMeters, item.widthMeters, item.quantity]),
  [['1.5', '0.04', 2]]
);

const replayed = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('main')]
});
assert.deepEqual(replayed, exact);

const pricedCut = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('priced-cut', {
    longitudinalCutRateToman: c('100')
  })]
});
assert.equal(pricedCut.ok, true);
if (!pricedCut.ok) throw new Error('Expected remainder cut pricing.');
assert.equal(pricedCut.result.allocations[0]?.cuttingAmountToman, '300');

const missingCutRate = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('missing-cut-rate', {
    longitudinalCutRateToman: undefined
  })]
});
assert.equal(missingCutRate.ok, false);
if (!missingCutRate.ok) {
  assert.equal(missingCutRate.conflicts[0]?.code, 'remainder-cut-rate-missing');
}

const noSource = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('main', { selectedRemainingStoneId: undefined })]
});
assert.equal(noSource.ok, false);
if (!noSource.ok) assert.equal(noSource.conflicts[0]?.code, 'explicit-source-required');

const doesNotFallThrough = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [
    stock('small', {
      remainingStoneId: id('remaining-stone', 'stock-small'),
      quantity: 1,
      creationOrder: 0
    }),
    stock('large', {
      remainingStoneId: id('remaining-stone', 'stock-large'),
      quantity: 10,
      creationOrder: 1
    })
  ],
  childIntents: [child('strict', {
    selectedRemainingStoneId: id('remaining-stone', 'stock-small'),
    quantity: 2
  })]
});
assert.equal(doesNotFallThrough.ok, false);
if (!doesNotFallThrough.ok) {
  assert.equal(doesNotFallThrough.conflicts[0]?.code, 'selected-remainder-insufficient');
}

const orderedChildren = [
  child('first', { allocationOrder: 5, quantity: 2 }),
  child('second', { allocationOrder: 9, quantity: 2 })
];
const atomicFailure = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: orderedChildren
});
assert.equal(atomicFailure.ok, false);
if (!atomicFailure.ok) {
  assert.equal(atomicFailure.conflicts[0]?.childProductRowId, id('product-row', 'child-second'));
}
assert.equal(stock('main').quantity, 3);

const afterDelete = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [orderedChildren[1]]
});
assert.equal(afterDelete.ok, true);
if (!afterDelete.ok) throw new Error('Expected inventory replay after child deletion.');
assert.equal(afterDelete.result.inventory.find(item =>
  item.remainingStoneId === id('remaining-stone', 'stock-main')
)?.quantity, 1);

assert.equal(canDeleteRemainderSource(sourceRowId, orderedChildren), false);
assert.equal(canDeleteRemainderSource(otherSourceRowId, orderedChildren), true);
assert.deepEqual(
  findRemainderDependents(sourceRowId, orderedChildren)
    .map(item => item.childProductRowId),
  [id('product-row', 'child-first'), id('product-row', 'child-second')]
);

const sourceMismatch = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [child('mismatch', { sourceProductRowId: otherSourceRowId })]
});
assert.equal(sourceMismatch.ok, false);
if (!sourceMismatch.ok) {
  assert.equal(sourceMismatch.conflicts[0]?.code, 'remainder-source-mismatch');
}

const changedSource = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [
    stock('main'),
    stock('other', {
      remainingStoneId: id('remaining-stone', 'stock-other'),
      ownerProductRowId: otherSourceRowId,
      sourceBatchId: id('source-batch', 'other-source-batch'),
      creationOrder: 1
    })
  ],
  childIntents: [child('changed-source', {
    sourceProductRowId: otherSourceRowId,
    selectedRemainingStoneId: id('remaining-stone', 'stock-other')
  })]
});
assert.equal(changedSource.ok, true);
if (!changedSource.ok) throw new Error('Expected explicit source change to succeed.');
assert.equal(changedSource.result.allocations[0]?.sourceProductRowId, otherSourceRowId);
assert.equal(
  changedSource.result.inventory.find(item =>
    item.remainingStoneId === id('remaining-stone', 'stock-main')
  )?.quantity,
  3
);

const duplicated = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [stock('main')],
  childIntents: [
    child('duplicate-1', { quantity: 1, allocationOrder: 0 }),
    child('duplicate-2', { quantity: 1, allocationOrder: 1 })
  ]
});
assert.equal(duplicated.ok, true);
if (!duplicated.ok) throw new Error('Expected explicit duplicate allocations.');
assert.equal(duplicated.result.allocations.length, 2);
assert.equal(
  duplicated.result.inventory.find(item =>
    item.remainingStoneId === id('remaining-stone', 'stock-main')
  )?.quantity,
  1
);

const allConflicts = replayRemainderAllocations({
  policyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  baseInventory: [],
  childIntents: [
    child('missing-1', { allocationOrder: 0 }),
    child('missing-2', { allocationOrder: 1 })
  ]
});
assert.equal(allConflicts.ok, false);
if (!allConflicts.ok) assert.equal(allConflicts.conflicts.length, 2);

const groupedBase = materializePaidRemainderStocks({
  ownerProductRowId: sourceRowId,
  catalogProductId: 'granite-1',
  sourceBatchId: id('source-batch', 'source-batch-materialized'),
  remainders: [
    {
      remainingStoneId: id('remaining-stone', 'physical-1'),
      sourceBatchId: id('source-batch', 'source-batch-materialized'),
      sourceOrdinal: 0,
      xMeters: c('0.12'),
      yMeters: c('0'),
      lengthMeters: c('1.5'),
      widthMeters: c('0.04')
    },
    {
      remainingStoneId: id('remaining-stone', 'physical-2'),
      sourceBatchId: id('source-batch', 'source-batch-materialized'),
      sourceOrdinal: 1,
      xMeters: c('0.12'),
      yMeters: c('0'),
      lengthMeters: c('1.5'),
      widthMeters: c('0.04')
    }
  ]
});
assert.equal(groupedBase.length, 1);
assert.equal(groupedBase[0]?.quantity, 2);
assert.equal(
  groupedBase[0]?.remainingStoneId,
  id('remaining-stone', `${sourceRowId}:base-remainder:1`)
);

console.log('remainder policy tests passed');
