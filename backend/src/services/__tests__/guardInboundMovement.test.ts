import assert from 'node:assert/strict';
import test from 'node:test';
import { presentGuardInboundMovement } from '../guardInboundMovement';

test('Guard movement presentation leaves ordinary loadings unchanged', () => {
  const movement = { id: 'movement-1', loading: { id: 'loading-1', sourceKind: 'SALES_CONTRACT',
    partnerCaseId: null, customer: { id: 'customer-1' } } };
  assert.equal(presentGuardInboundMovement(movement), movement);
});

test('Guard movement presentation removes private Partner source identity and snapshot', () => {
  const movement = { id: 'movement-2', loadingId: 'loading-2', loading: {
    id: 'loading-2', loadingNumber: 334n, sourceKind: 'PARTNER_CASE', status: 'FINALIZED',
    customerId: 'customer-2', customer: { id: 'customer-2', name: 'Customer' }, projectId: null, project: null,
    partnerCaseId: 'case-private', partnerCaseRevision: 7, partnerInternalRecordId: 'wholesale-private',
    partnerSourceHash: 'hash-private', partnerSourceSnapshot: { wholesaleUnitPrice: '100' },
    createdAt: new Date('2026-09-03T00:00:00.000Z'), finalizedAt: new Date('2026-09-03T01:00:00.000Z'),
  } };
  const projected = presentGuardInboundMovement(movement) as any;
  assert.equal(projected.loading.id, 'loading-2');
  assert.equal(projected.loading.customer.id, 'customer-2');
  for (const key of ['partnerCaseId', 'partnerCaseRevision', 'partnerInternalRecordId', 'partnerSourceHash', 'partnerSourceSnapshot']) {
    assert.equal(key in projected.loading, false, `${key} must stay outside the Guard movement response`);
  }
  const serialized = JSON.stringify(projected, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  assert.equal(serialized.includes('wholesaleUnitPrice'), false);
});
