import assert from 'node:assert/strict';
import { parseCanonicalDecimal as c } from '../canonicalDecimal';
import {
  calculateProductOperations,
  convertOperationGroupBasis,
  splitOperationGroup,
  type ProductOperationsInput
} from '../operationsPolicy';
import { parseStableIdentity } from '../stableIdentity';

const group = (id: string, scope: string) => ({
  operationGroupId: parseStableIdentity('operation-group', id),
  scope: c(scope)
});
const tool = (
  id: string,
  groupId: string,
  overrides: Record<string, unknown> = {}
) => ({
  toolSelectionId: parseStableIdentity('tool-selection', id),
  operationGroupId: parseStableIdentity('operation-group', groupId),
  catalogItemId: 'tool-catalog-1',
  catalogSnapshotVersion: 'inventory-1',
  name: 'نیم لول',
  unit: 'meter' as const,
  rateToman: c('100'),
  edges: ['front'] as const,
  ...overrides
});
const finishing = (
  id: string,
  groupId: string,
  overrides: Record<string, unknown> = {}
) => ({
  finishingSelectionId: parseStableIdentity('finishing-selection', id),
  operationGroupId: parseStableIdentity('operation-group', groupId),
  catalogItemId: 'finishing-catalog-1',
  catalogSnapshotVersion: 'inventory-1',
  name: 'ساب سطح',
  unit: 'squareMeter' as const,
  rateToman: c('50'),
  incompatibleCatalogItemIds: [] as readonly string[],
  ...overrides
});

const input = (
  overrides: Partial<ProductOperationsInput> = {}
): ProductOperationsInput => ({
  policyVersion: 'operations-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'half-up-v1',
  productRowId: parseStableIdentity('product-row', 'row-operations'),
  lengthMeters: c('1.5'),
  widthMeters: c('0.4'),
  quantity: 25,
  groups: [group('group-1', '10'), group('group-2', '15')],
  tools: [
    tool('tool-1', 'group-1', { name: 'قاشقی', edges: ['front'] }),
    tool('tool-2', 'group-1', { name: 'نیم لول', edges: ['left'] }),
    tool('tool-3', 'group-2', { name: 'نیم لول', edges: ['front'] })
  ],
  finishings: [],
  ...overrides
});

const mixed = calculateProductOperations(input());
assert.equal(mixed.ok, true);
if (mixed.ok) {
  assert.equal(mixed.result.basis, 'piece-count');
  assert.equal(mixed.result.noOperationScope, '0');
  assert.equal(mixed.result.groups.length, 2);
  assert.equal(mixed.result.tools[0]?.automaticQuantity, '15');
  assert.equal(mixed.result.tools[1]?.automaticQuantity, '4');
  assert.equal(mixed.result.tools[2]?.automaticQuantity, '22.5');
}

const uncovered = calculateProductOperations(input({
  groups: [group('group-1', '20')],
  tools: [tool('tool-1', 'group-1')]
}));
assert.equal(uncovered.ok, true);
if (uncovered.ok) {
  assert.equal(uncovered.result.noOperationScope, '5');
  assert.equal(uncovered.result.groups.at(-1)?.automaticNoOperations, true);
}

const overAllocated = calculateProductOperations(input({
  groups: [group('group-1', '20'), group('group-2', '6')],
  tools: []
}));
assert.equal(overAllocated.ok, false);
if (!overAllocated.ok) {
  assert.equal(overAllocated.conflicts[0]?.code, 'group-scope-exceeds-product');
  assert.equal(overAllocated.conflicts[0]?.availableScope, '5');
}

const meterBased = calculateProductOperations(input({
  quantity: undefined,
  lengthMeters: c('25'),
  groups: [group('group-1', '10'), group('group-2', '15')],
  tools: [
    tool('tool-1', 'group-1'),
    tool('tool-2', 'group-2', { name: 'قاشقی' })
  ],
  finishings: [finishing('finishing-1', 'group-1')]
}));
assert.equal(meterBased.ok, true);
if (meterBased.ok) {
  assert.equal(meterBased.result.basis, 'linear-meters');
  assert.equal(meterBased.result.tools[0]?.automaticQuantity, '10');
  assert.equal(meterBased.result.tools[1]?.automaticQuantity, '15');
  assert.equal(meterBased.result.finishings[0]?.automaticQuantity, '4');
}

const squareTool = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-square', 'group-1', {
    unit: 'squareMeter',
    edges: undefined
  })]
}));
assert.equal(squareTool.ok, true);
if (squareTool.ok) {
  assert.equal(squareTool.result.tools[0]?.automaticQuantity, '6');
}

const squareToolWithEdges = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-square', 'group-1', {
    unit: 'squareMeter',
    edges: ['front']
  })]
}));
assert.equal(squareToolWithEdges.ok, false);
if (!squareToolWithEdges.ok) {
  assert.equal(squareToolWithEdges.conflicts[0]?.code, 'edges-not-allowed');
}

const linearToolWithoutEdges = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-no-edge', 'group-1', { edges: [] })]
}));
assert.equal(linearToolWithoutEdges.ok, false);
if (!linearToolWithoutEdges.ok) {
  assert.equal(linearToolWithoutEdges.conflicts[0]?.code, 'tool-edge-required');
}

const repeatedFreeTools = calculateProductOperations(input({
  groups: [group('group-1', '25')],
  tools: [
    tool('tool-repeat-1', 'group-1', { rateToman: c('0') }),
    tool('tool-repeat-2', 'group-1', { rateToman: c('0') })
  ]
}));
assert.equal(repeatedFreeTools.ok, true);
if (repeatedFreeTools.ok) {
  assert.equal(repeatedFreeTools.result.tools.length, 2);
  assert.equal(repeatedFreeTools.result.tools[0]?.amountToman, '0');
  assert.equal(repeatedFreeTools.result.tools[1]?.amountToman, '0');
}

const missingInventoryRate = calculateProductOperations(input({
  groups: [group('group-1', '25')],
  tools: [tool('tool-missing-rate', 'group-1', { rateToman: undefined })]
}));
assert.equal(missingInventoryRate.ok, false);
if (!missingInventoryRate.ok) {
  assert.equal(missingInventoryRate.conflicts[0]?.code, 'inventory-rate-missing');
}

const staleOverride = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-override', 'group-1', {
    quantityOverride: {
      value: c('12'),
      automaticQuantitySnapshot: c('10')
    }
  })]
}));
assert.equal(staleOverride.ok, false);
if (!staleOverride.ok) {
  assert.equal(staleOverride.conflicts[0]?.code, 'manual-override-stale');
}

const keptOverride = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-override', 'group-1', {
    quantityOverride: {
      value: c('12'),
      automaticQuantitySnapshot: c('10'),
      resolution: 'keep'
    }
  })]
}));
assert.equal(keptOverride.ok, true);
if (keptOverride.ok) {
  assert.equal(keptOverride.result.tools[0]?.finalQuantity, '12');
  assert.equal(
    keptOverride.result.tools[0]?.quantityOverride?.automaticQuantitySnapshot,
    '15'
  );
  assert.equal(keptOverride.result.tools[0]?.quantityOverride?.resolution, undefined);
}

const useCalculation = calculateProductOperations(input({
  groups: [group('group-1', '10')],
  tools: [tool('tool-override', 'group-1', {
    quantityOverride: {
      value: c('12'),
      automaticQuantitySnapshot: c('10'),
      resolution: 'use-calculation'
    }
  })]
}));
assert.equal(useCalculation.ok, true);
if (useCalculation.ok) {
  assert.equal(useCalculation.result.tools[0]?.finalQuantity, '15');
  assert.equal(useCalculation.result.tools[0]?.quantityOverride, undefined);
}

const incompatible = calculateProductOperations(input({
  groups: [group('group-1', '25')],
  tools: [],
  finishings: [
    finishing('finishing-1', 'group-1', {
      catalogItemId: 'polished',
      incompatibleCatalogItemIds: ['matte']
    }),
    finishing('finishing-2', 'group-1', {
      catalogItemId: 'matte'
    })
  ]
}));
assert.equal(incompatible.ok, false);
if (!incompatible.ok) {
  assert.equal(incompatible.conflicts[0]?.code, 'finishing-incompatible');
}

const exactConversion = convertOperationGroupBasis({
  groups: [group('group-1', '10'), group('group-2', '15')],
  from: 'linear-meters',
  to: 'piece-count',
  lengthPerPieceMeters: c('2.5')
});
assert.equal(exactConversion.ok, true);
if (exactConversion.ok) {
  assert.deepEqual(exactConversion.groups.map(item => item.scope), ['4', '6']);
}

const inexactConversion = convertOperationGroupBasis({
  groups: [group('group-1', '10')],
  from: 'linear-meters',
  to: 'piece-count',
  lengthPerPieceMeters: c('3')
});
assert.equal(inexactConversion.ok, false);

const reverseConversion = convertOperationGroupBasis({
  groups: [group('group-1', '4')],
  from: 'piece-count',
  to: 'linear-meters',
  lengthPerPieceMeters: c('2.5')
});
assert.equal(reverseConversion.ok, true);
if (reverseConversion.ok) {
  assert.equal(reverseConversion.groups[0]?.scope, '10');
}

const split = splitOperationGroup({
  input: input({
    groups: [group('group-source', '25')],
    tools: [tool('tool-source', 'group-source')],
    finishings: [finishing('finishing-source', 'group-source')]
  }),
  sourceOperationGroupId: parseStableIdentity('operation-group', 'group-source'),
  selectedScope: c('10'),
  selectedOperationGroupId: parseStableIdentity('operation-group', 'group-selected'),
  clonedToolSelectionIds: {
    'tool-source': parseStableIdentity('tool-selection', 'tool-clone')
  },
  clonedFinishingSelectionIds: {
    'finishing-source': parseStableIdentity(
      'finishing-selection',
      'finishing-clone'
    )
  }
});
assert.equal(split.ok, true);
if (split.ok) {
  assert.deepEqual(split.input.groups.map(item => item.scope), ['10', '15']);
  assert.equal(split.input.tools.length, 2);
  assert.equal(split.input.finishings.length, 2);
  assert.equal(split.input.tools[1]?.operationGroupId, 'group-selected');
  assert.equal(split.input.finishings[1]?.operationGroupId, 'group-selected');
}

console.log('product operations policy tests passed');
