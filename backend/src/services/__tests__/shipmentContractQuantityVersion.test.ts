import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { captureContractQuantityVersionAtFinancialApproval, captureFinanciallyApprovedContractQuantityVersions, deriveContractedQuantity, guardReturnValidationFailure, isPersistedContractQuantitySupersededByApprovedPricing, resolveContractProductSnapshot, shipmentProjectionPersistenceData, shipmentQuantityEvidenceIntegrityHash, shipmentQuantityProjectionIntegrityHash } from '../shipmentQuantityProjectionStore';
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
    contractApprovedPricingVersion: { findUnique: async () => ({ rows: [{
      id: `pricing-row-${contractData.products[0].quantity}`,
      contractItemId: 'item-1',
      contractedQuantity: new Prisma.Decimal(contractData.products[0].quantity),
      unit: 'count',
    }] }) },
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

test('shipment capture uses the approved-pricing scale-three quantity instead of a legacy zero sentinel', async () => {
  const created: any[] = [];
  const tx = {
    salesContract: { findUnique: async () => ({
      id: 'contract-optimizer',
      contractData: { products: [{ rowId: 'row-optimizer', productId: 'product-a', productType: 'longitudinal', quantity: 0 }] },
      items: [{ id: 'item-optimizer', productRowId: 'row-optimizer', productId: 'product-a', productType: 'longitudinal', quantity: new Prisma.Decimal(0) }],
    }) },
    contractApprovedPricingVersion: { findUnique: async () => ({ rows: [{
      id: 'pricing-row-optimizer', contractItemId: 'frozen-item-optimizer', linkedContractItemId: 'item-optimizer',
      contractedQuantity: new Prisma.Decimal('58.333'), unit: 'meter',
    }] }) },
    shipmentQuantityEvidence: { createMany: async ({ data }: any) => { created.push(...data); return { count: data.length }; } },
  } as any;

  await captureContractQuantityVersionAtFinancialApproval(tx, {
    contractId: 'contract-optimizer', financialRecordId: 'approval-optimizer', approvedAt: new Date('2026-08-19T09:00:00.000Z'),
  });

  assert.equal(created[0].quantity, '58.333');
  assert.equal(created[0].unit, 'meter');
  assert.equal(created[0].metadata.quantityEvidenceOrigin, 'APPROVED_PRICING_ROW');
  assert.equal(created[0].metadata.approvedPricingRowId, 'pricing-row-optimizer');
  assert.equal(created[0].contractItemId, 'item-optimizer');
});

test('approved pricing prevents a later legacy zero-sentinel capture from superseding shipment truth', () => {
  const approvedItems = new Set(['item-optimizer']);
  assert.equal(isPersistedContractQuantitySupersededByApprovedPricing(
    { kind: 'CONTRACTED_SET', contractItemId: 'item-optimizer' }, approvedItems,
  ), true);
  assert.equal(isPersistedContractQuantitySupersededByApprovedPricing(
    { kind: 'PHYSICAL_EXIT', contractItemId: 'item-optimizer' }, approvedItems,
  ), false);
  assert.equal(isPersistedContractQuantitySupersededByApprovedPricing(
    { kind: 'CONTRACTED_SET', contractItemId: 'legacy-without-approved-pricing' }, approvedItems,
  ), false);
});

test('cutover bootstrap preserves its distinct source, timing, metadata, and integrity policy', async () => {
  const created: any[] = [];
  const contract = {
    id: 'contract-1', contractData: { products: [{ rowId: 'row-1', productId: 'product-a', unit: 'count', quantity: '4' }] },
    items: [{ id: 'item-1', productRowId: 'row-1', productId: 'product-a', productType: null, quantity: new Prisma.Decimal('4') }],
  };
  let evidenceRead = false;
  const prisma = {
    salesContract: { findMany: async () => [contract] },
    accountingFinancialRecord: { findMany: async () => [{ contractId: contract.id, financiallyApprovedAt: new Date('2026-07-31T09:00:00.000Z') }] },
    shipmentQuantityEvidence: {
      findMany: async () => { evidenceRead = true; return []; },
      createMany: async ({ data }: any) => { created.push(...data); return { count: data.length }; },
    },
  } as any;
  await captureFinanciallyApprovedContractQuantityVersions(prisma, { contractId: contract.id }, new Date('2026-08-07T10:00:00.000Z'));
  assert.equal(evidenceRead, true);
  assert.deepEqual({
    sourceId: created[0].sourceId, effectiveAt: created[0].effectiveAt.toISOString(), recordedAt: created[0].recordedAt.toISOString(), metadata: created[0].metadata,
  }, {
    sourceId: 'cutover:item-1', effectiveAt: '2026-08-07T10:00:00.000Z', recordedAt: '2026-08-07T10:00:00.000Z',
    metadata: { financiallyApprovedAt: '2026-07-31T09:00:00.000Z', capturedAtCutover: true },
  });
  const normalized = { ...created[0], id: '', effectiveAt: created[0].effectiveAt.toISOString(), recordedAt: created[0].recordedAt.toISOString() };
  assert.equal(created[0].integrityHash, shipmentQuantityEvidenceIntegrityHash(normalized));
});

const persistedReturn = (overrides: Record<string, any> = {}) => ({
  id: 'return-1', kind: 'GUARD_RETURN_VERIFIED', contractId: 'contract-1', contractItemId: 'item-1',
  productRowId: 'row-1', unit: 'count', quantity: new Prisma.Decimal('1.000'),
  guardReturnMovementId: 'movement-in', dispatchEvidenceId: 'exit-1',
  recordedAt: new Date('2026-08-07T11:00:00Z'),
  guardReturnMovement: { id: 'movement-in', direction: 'INBOUND', status: 'INFO_COMPLETED', purpose: 'SALES_RETURN', loadingId: 'loading-1',
    occurredAt: new Date('2026-08-07T10:30:00Z'), completedAt: new Date('2026-08-07T10:45:00Z') },
  dispatchEvidence: {
    id: 'exit-1', kind: 'PHYSICAL_EXIT', contractId: 'contract-1', contractItemId: 'item-1',
    productRowId: 'row-1', unit: 'count', quantity: new Prisma.Decimal('2.000'), effectiveAt: new Date('2026-08-07T10:00:00Z'),
    metadata: { loadingId: 'loading-1' },
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
  assert.equal(guardReturnValidationFailure(persistedReturn({
    metadata: { dispatchLoadingId: 'loading-1' }, dispatchEvidence: { ...persistedReturn().dispatchEvidence, metadata: {} },
  }), [] as any), null, 'return evidence may durably carry immutable dispatch loading attribution');
  assert.match(guardReturnValidationFailure(persistedReturn({
    guardReturnMovement: { ...persistedReturn().guardReturnMovement, occurredAt: new Date('2026-08-07T09:00:00Z') },
    dispatchEvidence: { ...persistedReturn().dispatchEvidence, effectiveAt: new Date('2026-08-07T10:00:00Z') },
  }), [] as any) || '', /before its physical dispatch/);
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
