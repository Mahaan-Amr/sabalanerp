import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { repairPartnerTechnicalOperationIds } from './partnerTechnicalOperationIds';

test('a selected tool keeps its group when an old generated ID is repaired', () => {
  const productRowId = 'product-row:1b89cbb0-b8b1-4822-9c5f-4f570f53e901';
  const reserved = `${productRowId}:no-operations`;
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 27,
    rows: [{ productRowId, family: 'longitudinal', catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z',
      configuration: { sourceBatchId: 'source', lengthMeters: '2', widthMeters: '0.35', quantity: 6,
        lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
      operations: { groups: [{ operationGroupId: reserved, scope: '5' }],
        tools: [{ toolSelectionId: 'tool', operationGroupId: reserved, catalogItemId: 'edge',
          catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', edges: ['front'] }], finishings: [] } }] });
  const repaired = repairPartnerTechnicalOperationIds(draft);
  const row = repaired.rows[0];
  assert.ok('operations' in row && row.operations);
  assert.equal(repaired.inputRevision, 28);
  assert.equal(row.operations.groups[0].scope, '5');
  assert.equal(row.operations.groups[0].operationGroupId, row.operations.tools[0].operationGroupId);
  assert.notEqual(row.operations.groups[0].operationGroupId, reserved);
  assert.equal(repairPartnerTechnicalOperationIds(repaired), repaired);
});
