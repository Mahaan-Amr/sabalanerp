import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplacementWizardData } from '../contractReplacement';

test('replacement preserves graph links with new identities and transfers no financial or approval authority', () => {
  const source: any = { customer: { id: 'customer', firstName: 'مشتری', customerType: 'INDIVIDUAL', salesContracts: [{ secret: true }] },
    contractData: { contractNumber: 'OLD', customerId: 'customer', products: [
      { rowId: 'parent', productId: 'catalog', sourceBatchId: 'batch', remainingStones: [{ rowId: 'remaining' }] },
      { rowId: 'child', parentProductRowId: 'parent', meta: { remainingSource: { sourceProductRowId: 'parent' } }, contractItemId: 'old-item' },
    ], serviceRows: [], payment: { payments: [{ amount: 999 }] }, deliveries: [{ id: 'old-delivery' }],
      discount: { amount: 100 }, signature: { contractId: 'old-contract', confirmationStatus: 'VERIFIED' } } };
  const original = JSON.stringify(source);
  let sequence = 0;
  const result = buildReplacementWizardData(source, () => `new-${++sequence}`);
  assert.equal(result.customerId, 'customer');
  assert.equal((result.customer as any).salesContracts, undefined);
  assert.notEqual(result.products[0].rowId, 'parent');
  assert.equal(result.products[1].parentProductRowId, result.products[0].rowId);
  assert.equal(result.products[1].meta?.remainingSource?.sourceProductRowId, result.products[0].rowId);
  assert.equal((result.products[1] as any).contractItemId, undefined);
  assert.equal(result.products[0].productId, 'catalog');
  assert.equal(result.contractNumber, '');
  assert.equal(result.signature, null);
  assert.equal(result.discount, null);
  assert.deepEqual(result.payment.payments, []);
  assert.deepEqual(result.deliveries, []);
  assert.equal(JSON.stringify(source), original);
});
