import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { partnerRemainderChildren } from './partnerDependentPresentation';

test('remainder children are nested below their stable parent identity in creation order', () => {
  const base = { kind: 'remainder' as const, catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z',
    lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const, sawKerfEnabled: false, calibrationEnabled: false };
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [
    { productRowId: 'parent-a', catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z',
      family: 'longitudinal', configuration: { sourceBatchId: 'source-a', lastManualField: 'length', lastManualDimension: 'length',
        lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'automatic' } },
    { productRowId: 'parent-b', catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-21T00:00:00.000Z',
      family: 'longitudinal', configuration: { sourceBatchId: 'source-b', lastManualField: 'length', lastManualDimension: 'length',
        lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'automatic' } },
  ], dependents: [
    { ...base, creationOrder: 3, allocationId: 'allocation-3', productRowId: 'child-a-2', sourceProductRowId: 'parent-a' },
    { ...base, creationOrder: 1, allocationId: 'allocation-1', productRowId: 'child-a-1', sourceProductRowId: 'parent-a' },
    { ...base, creationOrder: 2, allocationId: 'allocation-2', productRowId: 'grandchild-a', sourceProductRowId: 'child-a-1' },
    { ...base, creationOrder: 0, allocationId: 'allocation-b', productRowId: 'child-b', sourceProductRowId: 'parent-b' },
  ] });
  assert.deepEqual(partnerRemainderChildren(draft, 'parent-a').map(item => [item.row.productRowId, item.depth]), [
    ['child-a-1', 0], ['grandchild-a', 1], ['child-a-2', 0],
  ]);
});
