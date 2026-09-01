import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const c = graph.parseCanonicalDecimal;
const parentId = graph.parseStableIdentity('product-row', 'layer-parent');
const input = () => ({
  inputRevision: 5,
  layerConfigurationId: graph.parseStableIdentity('layer-configuration', 'layer-one'),
  parentProductRowId: parentId,
  sourceBatchId: graph.parseStableIdentity('source-batch', 'layer-batch'),
  creationOrder: 1, layerCatalogItemId: 'double', layerCatalogSnapshotVersion: 'catalog-v1',
  layerTitle: 'Double', layerUnit: 'set' as const, layersPerParentPiece: 2,
  widthMeters: c('0.04'), widthDisplayUnit: 'cm' as const, targetSides: ['front', 'left'] as const,
  source: { kind: 'new-material' as const, catalogProductId: 'stone', catalogSnapshotVersion: 'catalog-v1',
    sourceRows: [{ sourceRowId: graph.parseStableIdentity('layer-source-row', 'layer-source'),
      lengthMeters: c('3'), widthMeters: c('0.4'), quantity: 2 }] },
  kerfMeters: c('0'), calibrationEnabled: false, sideOperations: [],
});
const parent = { lengthMeters: c('1.2'), crossDimensionMeters: c('0.3'), quantity: 2 };

test('double layers expose actual front and side strips, source split and linked remainders without rates', () => {
  const calculation = graph.calculateStairLayerTechnical({ input: input(), parent, availableInventory: [] });
  assert.ok(calculation.ok);
  assert.equal(calculation.result.inputRevision, 5);
  assert.equal(calculation.result.layerConfigurationId, 'layer-one');
  assert.equal(calculation.result.parentProductRowId, parentId);
  assert.equal(calculation.result.commercialLayerSets, 4);
  assert.equal(calculation.result.physicalStripCount, 8);
  assert.deepEqual(calculation.result.physicalStrips.map(strip => [strip.side, strip.quantity, strip.lengthMeters]),
    [['front', 4, '1.2'], ['left', 4, '0.3']]);
  assert.equal(calculation.result.catalogQuantity, '4');
  assert.equal(calculation.result.materialSourceSplit.paidSourceCount, 0);
  assert.ok(calculation.result.generatedRemainders.length > 0);
  assert.ok(calculation.result.generatedRemainders.every(stock => stock.ownerProductRowId === parentId));
  assert.equal(/Rate|Amount|pricing|Pricing|Policy|inputHash|resultHash/.test(JSON.stringify(calculation)), false);
});

test('layer preview rejects nested private fields and inventory extensions without leaking them', () => {
  const small = { ...input(), targetSides: ['front'] as const, layersPerParentPiece: 1 };
  for (const invalid of [
    { ...small, layerRateToman: 'private-rate' },
    { ...small, source: { ...small.source, materialRateToman: 'private-material' } },
    { ...small, inputRevision: -1 },
  ]) {
    const result = graph.calculateStairLayerTechnical({ input: invalid as graph.StairLayerTechnicalInput, parent, availableInventory: [] });
    assert.ok(!result.ok);
    assert.equal(JSON.stringify(result).includes('private-'), false);
  }
  const inventory = [{ remainingStoneId: graph.parseStableIdentity('remaining-stone', 'old-stock'),
    ownerProductRowId: parentId, sourceBatchId: small.sourceBatchId, catalogProductId: 'stone',
    lengthMeters: c('1'), widthMeters: c('1'), quantity: 1, creationOrder: 0, materialPaid: true as const,
    secret: 'private-inventory' }];
  const result = graph.calculateStairLayerTechnical({ input: small, parent, availableInventory: inventory });
  assert.ok(!result.ok);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('one incomplete side preserves the other side quantities and the complete physical layer preview', () => {
  const operation = (side: 'front' | 'left'): graph.StairLayerTechnicalSideOperations => ({ side,
    operations: {
      inputRevision: 5, productRowId: parentId, lengthMeters: c(side === 'front' ? '1.2' : '0.3'),
      widthMeters: c('0.04'), quantity: 2,
      groups: [{ operationGroupId: graph.parseStableIdentity('operation-group', side), scope: c('2') }],
      tools: [{ toolSelectionId: graph.parseStableIdentity('tool-selection', `${side}-tool`),
        operationGroupId: graph.parseStableIdentity('operation-group', side), catalogItemId: 'edge',
        catalogSnapshotVersion: 'catalog-v1', name: 'Edge', unit: 'meter', edges: side === 'front' ? [] : ['front'] }],
      finishings: [],
    },
  });
  const calculation = graph.calculateStairLayerTechnical({ input: { ...input(), layersPerParentPiece: 1,
    sideOperations: [operation('front'), operation('left')] }, parent, availableInventory: [] });
  assert.ok(!calculation.ok);
  assert.equal(calculation.inputRevision, 5);
  assert.ok(calculation.result);
  assert.equal(calculation.result.physicalStripCount, 4);
  assert.equal(calculation.result.sideOperationResults.find(item => item.side === 'left')?.result.tools[0].automaticQuantity, '0.6');
  assert.ok(calculation.conflicts.some(conflict => conflict.field.startsWith('sideOperations.front')));
});

test('ordered layer replay cannot consume the same paid source twice and retains the earlier valid configuration', () => {
  const stock = { remainingStoneId: graph.parseStableIdentity('remaining-stone', 'single-stock'),
    ownerProductRowId: parentId, sourceBatchId: input().sourceBatchId, catalogProductId: 'stone',
    lengthMeters: c('1.2'), widthMeters: c('0.04'), quantity: 1, creationOrder: 0, materialPaid: true as const };
  const first: graph.StairLayerTechnicalInput = { ...input(), layersPerParentPiece: 1, targetSides: ['front'],
    source: { kind: 'paid-remainder', selectedRemainingStoneIds: [stock.remainingStoneId] } };
  const second = { ...first, layerConfigurationId: graph.parseStableIdentity('layer-configuration', 'layer-two'), creationOrder: 2 };
  const result = graph.replayStairLayerTechnical({ inputRevision: 5, inputs: [second, first],
    parents: new Map([[parentId, { ...parent, quantity: 1 }]]), baseInventory: [stock] });
  assert.ok(!result.ok);
  assert.equal(result.inputRevision, 5);
  assert.ok(result.conflicts.some(conflict => conflict.field.startsWith('layer-two.')));
  assert.equal(result.result?.configurations.length, 1);
  assert.equal(result.result?.configurations[0].result.layerConfigurationId, 'layer-one');
  assert.equal(stock.quantity, 1);
});

test('even unused remainder inventory must have positive physical dimensions', () => {
  const stock = { remainingStoneId: graph.parseStableIdentity('remaining-stone', 'invalid-stock'),
    ownerProductRowId: parentId, sourceBatchId: input().sourceBatchId, catalogProductId: 'stone',
    lengthMeters: c('-1'), widthMeters: c('0.04'), quantity: 1, creationOrder: 0, materialPaid: true as const };
  const result = graph.replayStairLayerTechnical({ inputRevision: 5, inputs: [], parents: new Map(), baseInventory: [stock] });
  assert.ok(!result.ok);
});
