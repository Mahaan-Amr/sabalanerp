import assert from 'node:assert/strict';
import test from 'node:test';
import { clonePartnerLayerOperations, partnerLayerSharedOperations } from './partnerLayerOperations';
import type { PartnerTechnicalOperationsIntent } from '@sabalanerp/partner-sales-contracts';
const intent: PartnerTechnicalOperationsIntent = { groups: [{ operationGroupId: 'group', scope: '40' }],
  tools: [{ operationGroupId: 'group', toolSelectionId: 'tool', catalogItemId: 'edge', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z', edges: ['front'] }],
  finishings: [{ operationGroupId: 'group', finishingSelectionId: 'finishing', catalogItemId: 'polish', catalogSnapshotVersion: '2026-09-26T00:00:00.000Z' }] };
test('bulk layer edits clone tools, finishings and groups with distinct stable side identities', () => {
  const front = clonePartnerLayerOperations(intent, 'front');
  const back = clonePartnerLayerOperations(front, 'back');
  assert.notEqual(front.groups[0].operationGroupId, back.groups[0].operationGroupId);
  assert.equal(back.groups[0].operationGroupId, back.tools[0].operationGroupId);
  assert.equal(back.groups[0].operationGroupId, back.finishings[0].operationGroupId);
  assert.equal(back.groups[0].scope, '40');
  assert.deepEqual(clonePartnerLayerOperations(back, 'back'), back);
  assert.equal(partnerLayerSharedOperations([front, back]).mixed, false);
  assert.deepEqual(intent.groups, [{ operationGroupId: 'group', scope: '40' }]);
});
test('bulk view discloses different side operations and displays only common selections', () => {
  const other = { ...clonePartnerLayerOperations(intent, 'back'), finishings: [] };
  const view = partnerLayerSharedOperations([intent, other]);
  assert.equal(view.mixed, true);
  assert.equal(view.operations.tools.length, 1);
  assert.equal(view.operations.finishings.length, 0);
  assert.equal(intent.finishings.length, 1);
});
