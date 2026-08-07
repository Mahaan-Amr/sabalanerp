import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { captureContractQuantityVersionAtFinancialApproval, deriveContractedQuantity, guardReturnValidationFailure, resolveContractProductSnapshot, shipmentProjectionPersistenceData, shipmentQuantityProjectionIntegrityHash } from '../shipmentQuantityProjectionStore';
import { projectShipmentQuantities } from '../shipmentQuantityProjection';

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

test('every financial approval captures an immutable contract-row version without a rebuild', async () => {
  const created: any[] = [];
  let contractData: any = { products: [{ rowId: 'row-1', productId: 'product-a', unit: 'count', quantity: '10' }] };
  const tx = {
    salesContract: { findUnique: async () => ({
      id: 'contract-1', contractData,
      items: [{ id: 'item-1', productRowId: 'row-1', productId: 'product-a', productType: null, quantity: new Prisma.Decimal('10') }],
    }) },
    shipmentQuantityEvidence: { createMany: async ({ data }: any) => { created.push(...data); return { count: data.length }; } },
  } as any;

  await captureContractQuantityVersionAtFinancialApproval(tx, {
    contractId: 'contract-1', financialRecordId: 'approval-1', approvedAt: new Date('2026-08-01T09:00:00.000Z'),
  });
  contractData = { products: [{ rowId: 'row-1', productId: 'product-a', unit: 'count', quantity: '7.500' }] };
  await captureContractQuantityVersionAtFinancialApproval(tx, {
    contractId: 'contract-1', financialRecordId: 'approval-2', approvedAt: new Date('2026-08-05T09:00:00.000Z'),
  });

  assert.deepEqual(created.map((row) => [row.sourceId, row.quantity, row.effectiveAt.toISOString()]), [
    ['approval-1:item-1', '10.000', '2026-08-01T09:00:00.000Z'],
    ['approval-2:item-1', '7.500', '2026-08-05T09:00:00.000Z'],
  ]);
  const evidence = created.map((row, index) => ({
    ...row, id: `approved-${index + 1}`, quantity: String(row.quantity),
    effectiveAt: row.effectiveAt.toISOString(), recordedAt: row.recordedAt.toISOString(),
  }));
  assert.equal(projectShipmentQuantities(evidence, { cutoff: '2026-08-03T00:00:00.000Z' }).rows[0]?.quantities?.contracted, '10.000');
  assert.equal(projectShipmentQuantities(evidence, { cutoff: '2026-08-06T00:00:00.000Z' }).rows[0]?.quantities?.contracted, '7.500');
});

const persistedReturn = (overrides: Record<string, any> = {}) => ({
  id: 'return-1', kind: 'GUARD_RETURN_VERIFIED', contractId: 'contract-1', contractItemId: 'item-1',
  productRowId: 'row-1', unit: 'count', quantity: new Prisma.Decimal('1.000'),
  guardReturnMovementId: 'movement-in', dispatchEvidenceId: 'exit-1',
  guardReturnMovement: { id: 'movement-in', direction: 'INBOUND', status: 'INFO_COMPLETED', purpose: 'SALES_RETURN', loadingId: 'loading-1' },
  dispatchEvidence: {
    id: 'exit-1', kind: 'PHYSICAL_EXIT', contractId: 'contract-1', contractItemId: 'item-1',
    productRowId: 'row-1', unit: 'count', quantity: new Prisma.Decimal('2.000'), metadata: { loadingId: 'loading-1' },
  },
  ...overrides,
});

test('verified Guard returns reject fabricated, outbound, and incomplete movements', () => {
  assert.match(guardReturnValidationFailure(persistedReturn({ guardReturnMovement: null }), [] as any) || '', /movement is missing/);
  assert.match(guardReturnValidationFailure(persistedReturn({ guardReturnMovement: { id: 'movement-in', direction: 'OUTBOUND', status: 'INFO_COMPLETED', purpose: 'SALES_RETURN', loadingId: 'loading-1' } }), [] as any) || '', /inbound/);
  assert.match(guardReturnValidationFailure(persistedReturn({ guardReturnMovement: { id: 'movement-in', direction: 'INBOUND', status: 'ENTRY_RECORDED', purpose: 'SALES_RETURN', loadingId: 'loading-1' } }), [] as any) || '', /completed/);
});

test('verified Guard return movement cannot be reused for another dispatch attribution', () => {
  const row = persistedReturn();
  const incompatible = persistedReturn({ id: 'return-2', dispatchEvidenceId: 'exit-2' });
  assert.match(guardReturnValidationFailure(row, [row, incompatible] as any) || '', /reused/);
});

test('verified Guard return must preserve row and loading attribution to its dispatch', () => {
  assert.match(guardReturnValidationFailure(persistedReturn({ contractItemId: 'other-row' }), [] as any) || '', /contractItemId/);
  assert.match(guardReturnValidationFailure(persistedReturn({
    guardReturnMovement: { id: 'movement-in', direction: 'INBOUND', status: 'INFO_COMPLETED', purpose: 'SALES_RETURN', loadingId: 'other-loading' },
  }), [] as any) || '', /loading attribution/);
});

test('materialization preserves verified time and requested cutoff for unsafe fallback rows', () => {
  const data = shipmentProjectionPersistenceData({
    contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'count',
    quantities: { contracted: '8.000', finalizedReserved: '1.000', physicallyDispatched: '2.000', availableToLoad: '5.000' },
    health: 'STALE', healthReasons: ['refresh incomplete'], hasNegativeAvailability: false, canAuthorizeLoading: false,
    cutoff: '2026-08-07T10:00:00.000Z', lastVerifiedAt: '2026-08-01T09:00:00.000Z', sourceEvidenceIds: ['e1'],
  });
  assert.equal(data.cutoff.toISOString(), '2026-08-07T10:00:00.000Z');
  assert.equal(data.lastVerifiedAt?.toISOString(), '2026-08-01T09:00:00.000Z');
});
