import assert from 'node:assert/strict';
import {
  calculateStairLayerConfiguration,
  duplicateStairLayerConfigurationDraft,
  replayStairLayerConfigurations,
  type StairLayerConfigurationInput
} from '../stairLayerPolicy';
import { parseCanonicalDecimal } from '../canonicalDecimal';
import { parseStableIdentity } from '../stableIdentity';
import type { PaidRemainderStock } from '../remainderPolicy';

const decimal = parseCanonicalDecimal;
const parentRowId = parseStableIdentity('product-row', 'stair-parent-1');
const layerId = parseStableIdentity('layer-configuration', 'layer-config-1');
const sourceBatchId = parseStableIdentity('source-batch', 'layer-source-batch-1');

const input = (
  overrides: Partial<StairLayerConfigurationInput> = {}
): StairLayerConfigurationInput => ({
  calculationPolicyVersion: 'calc-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  layerConfigurationId: layerId,
  parentProductRowId: parentRowId,
  sourceBatchId,
  creationOrder: 1,
  layerCatalogItemId: 'layer-double',
  layerCatalogSnapshotVersion: 'layer-catalog-v3',
  layerTitle: 'Double layer',
  layerUnit: 'set',
  layerRateToman: decimal('80000'),
  layersPerParentPiece: 2,
  widthMeters: decimal('0.04'),
  widthDisplayUnit: 'cm',
  targetSides: ['front', 'left'],
  source: {
    kind: 'new-material',
    catalogProductId: 'stone-1',
    catalogSnapshotVersion: 'stone-v4',
    materialRateToman: decimal('1000000'),
    sourceRows: [{
      sourceRowId: parseStableIdentity('layer-source-row', 'new-source-row-1'),
      lengthMeters: decimal('3'),
      widthMeters: decimal('0.4'),
      quantity: 2
    }]
  },
  kerfMeters: decimal('0'),
  calibrationEnabled: false,
  longitudinalCutRateToman: decimal('0'),
  crossCutRateToman: decimal('0'),
  calibrationCutRateToman: decimal('0'),
  sideOperations: [{
    side: 'front',
    operations: {
      policyVersion: 'calc-v1',
      pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1',
      productRowId: parentRowId,
      lengthMeters: decimal('1.2'),
      widthMeters: decimal('0.04'),
      quantity: 4,
      groups: [{
        operationGroupId: parseStableIdentity(
          'operation-group',
          'layer-front-group-1'
        ),
        scope: decimal('4')
      }],
      tools: [{
        toolSelectionId: parseStableIdentity(
          'tool-selection',
          'layer-front-tool-1'
        ),
        operationGroupId: parseStableIdentity(
          'operation-group',
          'layer-front-group-1'
        ),
        catalogItemId: 'tool-1',
        catalogSnapshotVersion: 'tool-v1',
        name: 'Edge tool',
        unit: 'meter',
        rateToman: decimal('100'),
        edges: ['front']
      }],
      finishings: []
    }
  }],
  ...overrides
});

{
  const calculated = calculateStairLayerConfiguration({
    input: input(),
    parent: {
      lengthMeters: decimal('1.2'),
      crossDimensionMeters: decimal('0.3'),
      quantity: 2
    },
    availableInventory: []
  });
  assert.equal(calculated.ok, true, JSON.stringify(calculated));
  if (!calculated.ok) throw new Error('Expected mixed-strip layer calculation.');
  assert.equal(calculated.result.commercialLayerSets, 4);
  assert.equal(calculated.result.physicalStripCount, 8);
  assert.deepEqual(
    calculated.result.physicalStrips.map(strip => [
      strip.side,
      strip.quantity,
      strip.lengthMeters
    ]),
    [
      ['front', 4, '1.2'],
      ['left', 4, '0.3']
    ]
  );
  assert.deepEqual(
    new Set(calculated.result.packingPlan.placements.map(item => item.demandId)),
    new Set([`${layerId}:front`, `${layerId}:left`])
  );
  assert.equal(calculated.result.layerPricingQuantity, '4');
  assert.equal(calculated.result.layerAmountToman, '320000');
  assert.equal(calculated.result.sideOperationResults[0]?.result.totalAmountToman, '480');
  assert.ok(calculated.result.generatedRemainders.length > 0);
}

{
  const invalidRate = calculateStairLayerConfiguration({
    input: input({ layerRateToman: decimal('0') }),
    parent: {
      lengthMeters: decimal('1.2'),
      crossDimensionMeters: decimal('0.3'),
      quantity: 2
    },
    availableInventory: []
  });
  assert.equal(invalidRate.ok, false);
  if (invalidRate.ok) throw new Error('Expected zero layer rate to fail.');
  assert.equal(invalidRate.conflicts[0]?.code, 'layer-rate-required');
}

{
  const stock: PaidRemainderStock = {
    remainingStoneId: parseStableIdentity('remaining-stone', 'paid-stock-1'),
    ownerProductRowId: parentRowId,
    catalogProductId: 'stone-1',
    sourceBatchId: parseStableIdentity('source-batch', 'parent-source-batch'),
    lengthMeters: decimal('3'),
    widthMeters: decimal('0.4'),
    quantity: 1,
    creationOrder: 0,
    materialPaid: true
  };
  const paid = input({
    targetSides: ['front'],
    layersPerParentPiece: 1,
    sideOperations: [],
    source: {
      kind: 'paid-remainder',
      selectedRemainingStoneIds: [stock.remainingStoneId]
    }
  });
  const second = {
    ...paid,
    layerConfigurationId: parseStableIdentity(
      'layer-configuration',
      'layer-config-2'
    ),
    sourceBatchId: parseStableIdentity('source-batch', 'layer-source-batch-2'),
    creationOrder: 2
  };
  const missing = {
    ...paid,
    layerConfigurationId: parseStableIdentity(
      'layer-configuration',
      'layer-config-3'
    ),
    sourceBatchId: parseStableIdentity('source-batch', 'layer-source-batch-3'),
    creationOrder: 3,
    source: {
      kind: 'paid-remainder' as const,
      selectedRemainingStoneIds: [
        parseStableIdentity('remaining-stone', 'not-selected-elsewhere')
      ]
    }
  };
  const parents = new Map([[
    parentRowId,
    {
      lengthMeters: decimal('1.2'),
      crossDimensionMeters: decimal('0.3'),
      quantity: 1
    }
  ]]);
  const replayed = replayStairLayerConfigurations({
    inputs: [second, paid],
    parents,
    baseInventory: [stock]
  });
  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  if (!replayed.ok) throw new Error('Expected stable paid-source replay.');
  assert.deepEqual(
    replayed.result.configurations.map(item => item.input.layerConfigurationId),
    [layerId, second.layerConfigurationId]
  );
  assert.equal(
    replayed.result.configurations[1]?.result.packingPlan.consumedSources
      .some(source => source.sourceBatchId.includes(':layer-remainder:')),
    true
  );
  assert.equal(
    replayed.result.inventory.some(
      item => item.remainingStoneId === stock.remainingStoneId
    ),
    false
  );

  const insufficient = replayStairLayerConfigurations({
    inputs: [paid, second, missing],
    parents,
    baseInventory: [stock]
  });
  assert.equal(insufficient.ok, false);
  if (insufficient.ok) throw new Error('Expected missing explicit source to fail.');
  assert.equal(insufficient.conflicts[0]?.code, 'layer-source-missing');

  const duplicated = duplicateStairLayerConfigurationDraft({
    source: paid,
    layerConfigurationId: parseStableIdentity(
      'layer-configuration',
      'duplicated-layer'
    ),
    sourceBatchId: parseStableIdentity('source-batch', 'duplicated-layer-source'),
    sideOperations: []
  });
  assert.equal('source' in duplicated, false);
  assert.notEqual(duplicated.layerConfigurationId, paid.layerConfigurationId);
  assert.notEqual(duplicated.sourceBatchId, paid.sourceBatchId);
}

console.log('stair layer policy tests passed');
