import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { overridePartnerStairQuantity, updatePartnerStairMotherLength } from './PartnerTechnicalDraftEditor';

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

test('mother stone length accepts decimal metres and centimetres and clearing restores the derived length', () => {
  const changed = updatePartnerStairMotherLength(draft, productRowId, '2.35', 'm');
  assert.equal(changed.rows[0].configuration.motherLengthMeters, '2.35');
  const centimetres = updatePartnerStairMotherLength(changed, productRowId, '235', 'cm');
  assert.equal(centimetres.rows[0].configuration.motherLengthMeters, '2.35');
  const cleared = updatePartnerStairMotherLength(centimetres, productRowId, '', 'cm');
  assert.equal(cleared.rows[0].configuration.motherLengthMeters, undefined);
  assert.equal(cleared.rows[0].configuration.lengthMeters, '2');
  assert.equal(cleared.editingValues?.length, 0);
});
