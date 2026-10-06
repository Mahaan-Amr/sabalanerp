import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { overridePartnerStairQuantity, updatePartnerStairMotherLength, updatePartnerStairSystemQuantity } from './PartnerTechnicalDraftEditor';

const productRowId = 'product-row:1b89cbb0-b8b1-4822-9c5f-4f570f53e901';
const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1,
  rows: [{ productRowId, family: 'stair', catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z',
    configuration: { stairSystemId: 'stair-system:test', part: 'tread', sourceBatchId: 'source-batch:test',
      lengthMeters: '2', crossDimensionMeters: '0.35', motherLengthMeters: '3', quantity: 100,
      quantityMode: 'manual', lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    operations: { groups: [{ operationGroupId: 'operation-group:test', scope: '100' }],
      tools: [], finishings: [] } }] });

test('reducing a stair count resizes its single full-coverage operation group', () => {
  const changed = overridePartnerStairQuantity(draft, productRowId, '80');
  const row = changed.rows[0];
  if (row.family !== 'stair') throw new Error('Expected a stair row');
  assert.equal(row.configuration.quantity, 80);
  assert.equal(row.operations?.groups[0].scope, '80');
});

test('system stair count changes resize whole-product operations in both quantity modes', () => {
  const systemDraft = PartnerTechnicalDraftSchema.parse({ ...draft,
    stairSystems: [{ stairSystemId: 'stair-system:test', quantity: { mode: 'steps', totalSteps: 100 } }],
    rows: draft.rows.map(row => ({ ...row, configuration: { ...row.configuration, quantityMode: 'system', quantity: undefined } })),
  });
  for (const quantity of [{ mode: 'steps' as const, totalSteps: 73 },
    { mode: 'steps' as const, totalSteps: 124 },
    { mode: 'staircases' as const, numberOfStaircases: 3, stepsPerStaircase: 17 }]) {
    const changed = updatePartnerStairSystemQuantity(systemDraft, 'stair-system:test', quantity);
    const row = changed.rows[0];
    if (row.family !== 'stair') throw new Error('Expected stair');
    assert.equal(row.operations?.groups[0].scope, String(quantity.mode === 'steps' ? quantity.totalSteps : 51));
    assert.equal(row.configuration.quantityMode, 'system');
    assert.equal(row.operations?.groups[0].operationGroupId, 'operation-group:test');
  }
  const cleared = updatePartnerStairSystemQuantity(systemDraft, 'stair-system:test', { mode: 'steps' });
  const retyped = updatePartnerStairSystemQuantity(cleared, 'stair-system:test', { mode: 'steps', totalSteps: 42 });
  assert.equal(retyped.rows[0].family === 'stair' && retyped.rows[0].operations?.groups[0].scope, '42');
});

test('mother stone length accepts decimal metres and centimetres and clearing restores the derived length', () => {
  const changed = updatePartnerStairMotherLength(draft, productRowId, '2.35', 'm');
  assert.ok(changed.rows[0].family === 'stair');
  assert.equal(changed.rows[0].configuration.motherLengthMeters, '2.35');
  const centimetres = updatePartnerStairMotherLength(changed, productRowId, '235', 'cm');
  assert.ok(centimetres.rows[0].family === 'stair');
  assert.equal(centimetres.rows[0].configuration.motherLengthMeters, '2.35');
  const cleared = updatePartnerStairMotherLength(centimetres, productRowId, '', 'cm');
  assert.ok(cleared.rows[0].family === 'stair');
  assert.equal(cleared.rows[0].configuration.motherLengthMeters, undefined);
  assert.equal(cleared.rows[0].configuration.lengthMeters, '2');
  assert.equal(cleared.editingValues?.length, 0);
});

test('system count changes preserve split groups, manually counted rows, and layer operation selections', () => {
  const layerId = 'layer-configuration:test';
  const withLayers = PartnerTechnicalDraftSchema.parse({ ...draft,
    stairSystems: [{ stairSystemId: 'stair-system:test', quantity: { mode: 'steps', totalSteps: 100 } }],
    rows: [
      { ...draft.rows[0], configuration: { ...draft.rows[0].configuration, quantityMode: 'system' } },
      { ...draft.rows[0], productRowId: 'product-row:manual', operations: { groups: [
        { operationGroupId: 'operation-group:manual', scope: '100' }], tools: [], finishings: [] } },
      { ...draft.rows[0], productRowId: 'product-row:split', configuration: { ...draft.rows[0].configuration, quantityMode: 'system' },
        operations: { groups: [{ operationGroupId: 'operation-group:a', scope: '20' },
          { operationGroupId: 'operation-group:b', scope: '80' }], tools: [], finishings: [] } },
    ],
    dependents: [{ kind: 'layer', parentProductRowId: productRowId, layerConfigurationId: layerId,
      creationOrder: 1, catalogItemId: 'layer', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z',
      layersPerParentPiece: 2, widthMeters: '0.05', widthDisplayUnit: 'cm', targetSides: ['front'],
      sourceBatchId: 'source-batch:layer', sawKerfEnabled: false, calibrationEnabled: false,
      sideOperations: [{ side: 'front', operationCollectionId: 'layer-operation-collection:test', scopeIntent: 'side', operations: {
        groups: [{ operationGroupId: 'operation-group:layer', scope: '200' }],
        tools: [{ toolSelectionId: 'tool-selection:layer', operationGroupId: 'operation-group:layer',
          catalogItemId: 'tool', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', edges: ['front'] }],
        finishings: [],
      } }],
    }],
  });
  const changed = updatePartnerStairSystemQuantity(withLayers, 'stair-system:test', { mode: 'steps', totalSteps: 47 });
  assert.deepEqual(changed.rows[1], withLayers.rows[1]);
  assert.deepEqual('operations' in changed.rows[2] && changed.rows[2].operations?.groups,
    'operations' in withLayers.rows[2] && withLayers.rows[2].operations?.groups);
  const layer = changed.dependents?.[0];
  const before = withLayers.dependents?.[0];
  if (layer?.kind !== 'layer' || before?.kind !== 'layer') throw new Error('Expected layer');
  assert.equal(layer.sideOperations?.[0].operations.groups[0].scope, '94');
  assert.deepEqual(layer.sideOperations?.[0].operations.tools, before.sideOperations?.[0].operations.tools);
});
