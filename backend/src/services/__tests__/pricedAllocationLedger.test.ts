import assert from 'node:assert/strict';
import {
  PricedAllocationInvariantError,
  allocatePricedRevision,
  type LockedApprovedPricingVersion,
} from '../pricedAllocationLedger';

const version = (overrides: Partial<LockedApprovedPricingVersion> = {}): LockedApprovedPricingVersion => ({
  id: 'pricing-1',
  contractId: 'contract-1',
  versionNumber: 1,
  sourceFinancialRecordId: 'approval-1',
  approvedAt: '2026-08-09T10:00:00.000Z',
  approvedBy: 'finance-1',
  schemaVersion: 1,
  currency: 'TOMAN',
  grossAmount: '300.000000000000',
  discountAmount: '10.000000000000',
  netAmount: '290.000000000000',
  integrityHash: 'pricing-hash-1',
  readinessEvidenceHash: 'ready-hash-1',
  rows: [
    {
      id: 'pricing-row-1', contractItemId: 'item-1', productRowId: 'stable-row-1', ordinal: 0,
      contractedQuantity: '3.000', unit: 'm2', canonicalAllInTotal: '100.000000000000',
      discountEligible: true, componentEvidence: { material: '90.000000000000', attachedCosts: '10.000000000000', discountBasis: '80.000000000000' },
      integrityHash: 'row-hash-1',
    },
    {
      id: 'pricing-row-2', contractItemId: 'item-2', productRowId: 'stable-row-2', ordinal: 1,
      contractedQuantity: '2.000', unit: 'm2', canonicalAllInTotal: '200.000000000000',
      discountEligible: true, componentEvidence: { material: '200.000000000000', discountBasis: '20.000000000000' },
      integrityHash: 'row-hash-2',
    },
  ],
  ...overrides,
});

const line = (quantity: string, overrides: Record<string, string> = {}) => ({
  allocationRevisionLineId: `line-${quantity}`,
  contractId: 'contract-1',
  contractItemId: 'item-1',
  productRowId: 'stable-row-1',
  quantity,
  unit: 'm2',
  ...overrides,
});

{
  const first = allocatePricedRevision({ versions: [version()], priorEvents: [], lines: [line('1.000')] });
  assert.deepEqual(first.events[0], {
    allocationRevisionLineId: 'line-1.000', pricingVersionId: 'pricing-1', pricingRowId: 'pricing-row-1',
    contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'stable-row-1', unit: 'm2', quantity: '1.000',
    grossAmount: '33.333333333333', discountAmount: '2.666666666666', netAmount: '30.666666666667',
    consumesFinalRemainder: false,
    evidence: {
      schemaVersion: 1, algorithm: 'shipment-money-allocation-v1',
      beforeQuantity: '0.000', afterQuantity: '1.000', contractedQuantity: '3.000',
      grossTarget: '100.000000000000', discountTarget: '8.000000000000',
      beforeGross: '0.000000000000', afterGross: '33.333333333333',
      beforeDiscount: '0.000000000000', afterDiscount: '2.666666666666',
      pricingIntegrityHash: 'pricing-hash-1', pricingRowIntegrityHash: 'row-hash-1', readinessEvidenceHash: 'ready-hash-1',
    },
  });

  const final = allocatePricedRevision({
    versions: [version()],
    priorEvents: first.events,
    lines: [line('2.000', { allocationRevisionLineId: 'line-final' })],
  });
  assert.equal(final.events[0].grossAmount, '66.666666666667');
  assert.equal(final.events[0].discountAmount, '5.333333333334');
  assert.equal(final.events[0].netAmount, '61.333333333333');
  assert.equal(final.events[0].consumesFinalRemainder, true);
  assert.equal(final.totals.grossAmount, '66.666666666667');
}

{
  const multi = allocatePricedRevision({
    versions: [version(), version({
      id: 'pricing-2', contractId: 'contract-2', sourceFinancialRecordId: 'approval-2', integrityHash: 'pricing-hash-2', readinessEvidenceHash: 'ready-hash-2',
      grossAmount: '50.000000000000', discountAmount: '0.000000000000', netAmount: '50.000000000000',
      rows: [{
        id: 'pricing-row-3', contractItemId: 'item-3', productRowId: 'stable-row-3', ordinal: 0,
        contractedQuantity: '1.000', unit: 'count', canonicalAllInTotal: '50.000000000000', discountEligible: false,
        componentEvidence: { material: '50.000000000000' }, integrityHash: 'row-hash-3',
      }],
    })],
    priorEvents: [],
    lines: [
      line('1.000'),
      line('1.000', { allocationRevisionLineId: 'line-contract-2', contractId: 'contract-2', contractItemId: 'item-3', productRowId: 'stable-row-3', unit: 'count' }),
    ],
  });
  assert.deepEqual(multi.totals, {
    quantity: '2.000', grossAmount: '83.333333333333', discountAmount: '2.666666666666', netAmount: '80.666666666667',
  });
  assert.equal(multi.events[1].pricingRowId, 'pricing-row-3');
}

assert.throws(
  () => allocatePricedRevision({ versions: [version()], priorEvents: [], lines: [line('1.000', { unit: 'count' })] }),
  (error: unknown) => error instanceof PricedAllocationInvariantError && error.code === 'UNIT_MISMATCH',
);

assert.throws(
  () => allocatePricedRevision({
    versions: [version({ rows: [{ ...version().rows[0], componentEvidence: { material: '100.000000000000' } }] })],
    priorEvents: [], lines: [line('1.000')],
  }),
  (error: unknown) => error instanceof PricedAllocationInvariantError && error.code === 'MISSING_DISCOUNT_BASIS',
);

{
  const over = allocatePricedRevision({
    versions: [version()], priorEvents: [], lines: [line('4.000')],
  });
  assert.equal(over.events[0].evidence.afterQuantity, '4.000');
  assert.equal(over.events[0].grossAmount, '133.333333333333');
  assert.equal(over.events[0].consumesFinalRemainder, false);
}

console.log('priced allocation ledger tests passed');
