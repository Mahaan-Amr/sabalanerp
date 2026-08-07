import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { deriveContractedQuantity, resolveContractProductSnapshot, shipmentQuantityProjectionIntegrityHash } from '../shipmentQuantityProjectionStore';

test('stable productRowId is the only canonical snapshot identity', () => {
  const data = { products: [{ rowId: 'row-a', productId: 'same' }, { rowId: 'row-b', productId: 'same' }] };
  assert.equal(resolveContractProductSnapshot(data, { productRowId: 'row-b', productId: 'same' }).snapshot?.rowId, 'row-b');
  assert.match(resolveContractProductSnapshot(data, { productRowId: 'missing', productId: 'same' }).conflict || '', /no matching/);
});

test('legacy index mapping requires both saved index and product ID agreement', () => {
  const data = { products: [{ rowId: null, productId: 'product-a' }] };
  assert.equal(resolveContractProductSnapshot(data, { productRowId: null, productId: 'product-a', legacyProductIndex: 0 }).snapshot?.productId, 'product-a');
  assert.match(resolveContractProductSnapshot(data, { productRowId: null, productId: 'product-b', legacyProductIndex: 0 }).conflict || '', /do not agree/);
  assert.match(resolveContractProductSnapshot(data, { productRowId: null, productId: 'product-a' }).conflict || '', /no validated legacy index/);
});

test('contract quantity derivation uses decimal arithmetic and refuses hidden rounding', () => {
  const item = { quantity: new Prisma.Decimal('1'), productType: 'longitudinal' };
  assert.equal(deriveContractedQuantity(item, { length: '0.1', quantity: '0.2' }, 'meter'), '0.020');
  assert.throws(() => deriveContractedQuantity(item, { length: '1.0004', quantity: '1' }, 'meter'), /scale three/);
});

test('last verified projection hash binds every displayed quantity', () => {
  const row = {
    contractId: 'c1', contractItemId: 'i1', productRowId: 'r1', unit: 'count',
    quantities: { contracted: '2.000', finalizedReserved: '1.000', physicallyDispatched: '0.000', availableToLoad: '1.000' },
    health: 'CURRENT', healthReasons: [], sourceEvidenceIds: ['e1'], cutoff: '2026-08-01T00:00:00.000Z', lastVerifiedAt: '2026-08-01T00:00:00.000Z',
  };
  assert.notEqual(shipmentQuantityProjectionIntegrityHash(row), shipmentQuantityProjectionIntegrityHash({ ...row, quantities: { ...row.quantities, availableToLoad: '0.000' } }));
});
