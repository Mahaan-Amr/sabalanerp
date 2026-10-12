import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateProductOperationsTechnical, parseCanonicalDecimal as c, parseStableIdentity as id } from '@sabalanerp/contract-product-graph';
import { partnerOperationMinimumFailure } from './partnerOperationMinimum';

test('partner operation preview and standalone service quantities qualify the same catalog item together', () => {
  const result = calculateProductOperationsTechnical({ inputRevision: 1, productRowId: id('product-row', 'row'), lengthMeters: c('200'), widthMeters: c('0.4'),
    groups: [{ operationGroupId: id('operation-group', 'group'), scope: c('200') }],
    tools: [{ toolSelectionId: id('tool-selection', 'selection'), operationGroupId: id('operation-group', 'group'),
      catalogItemId: 'tool', catalogSnapshotVersion: '2026-10-12T00:00:00.000Z', name: 'اسکراچ', unit: 'meter', edges: ['front'] }], finishings: [] });
  const operations = [{ kind: 'TOOL' as const, catalogItemId: 'tool', catalogSnapshotVersion: '2026-10-12T00:00:00.000Z', name: 'اسکراچ', unit: 'meter' as const, minimumQuantity: '300' }];
  const services = [{ serviceRowId: 'service', sourceType: 'tool' as const, catalogItemId: 'tool', catalogSnapshotVersion: '2026-10-12T00:00:00.000Z', title: 'اسکراچ', unit: 'meter' as const, quantity: '100' }];
  assert.equal(partnerOperationMinimumFailure({ ok: true, value: { rows: [{ operations: result }] } }, operations, services), null);
  assert.match(partnerOperationMinimumFailure({ ok: true, value: { rows: [{ operations: result }] } }, operations, [])!, /کسری: ۱۰۰ متر طول/);
});
test('standalone-only partner orders get their rule from the service catalog without a product operation', () => {
  const catalog = [{ sourceType: 'finishing' as const, catalogItemId: 'finish', catalogSnapshotVersion: '2026-10-12T00:00:00.000Z', name: 'پرداخت', unit: 'squareMeter' as const, minimumQuantity: '12.5' }];
  const services = [{ serviceRowId: 'service', sourceType: 'finishing' as const, catalogItemId: 'finish', catalogSnapshotVersion: '2026-10-12T00:00:00.000Z', title: 'پرداخت', unit: 'squareMeter' as const, quantity: '12' }];
  assert.match(partnerOperationMinimumFailure({}, [], services, catalog)!, /کسری: ۰.۵ متر مربع/);
  assert.equal(partnerOperationMinimumFailure({}, [], [{ ...services[0], quantity: '12.5' }], catalog), null);
});
