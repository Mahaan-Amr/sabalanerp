import assert from 'node:assert/strict';
import {
  AllocationPricingBindingError,
  bindFinalizedAllocationPricing,
  type AllocationPricingBindingPort,
  type LockedPricingEvidence,
} from '../allocationPricingBinding';

const lockedEvidence = (): LockedPricingEvidence => ({
  version: {
    id: 'pricing-1', contractId: 'contract-1', versionNumber: 1, sourceFinancialRecordId: 'approval-1',
    approvedAt: '2026-08-09T10:00:00.000Z', approvedBy: 'finance-1', schemaVersion: 1, currency: 'TOMAN',
    grossAmount: '100.000000000000', discountAmount: '5.000000000000', netAmount: '95.000000000000',
    integrityHash: 'pricing-hash-1', readinessEvidenceHash: 'ready-hash-1',
    rows: [{
      id: 'pricing-row-1', contractItemId: 'item-1', productRowId: 'stable-row-1', ordinal: 0,
      contractedQuantity: '2.000', unit: 'm2', canonicalAllInTotal: '100.000000000000', discountEligible: true,
      componentEvidence: { material: '90.000000000000', attachedCosts: '10.000000000000', discountBasis: '80.000000000000' },
      integrityHash: 'row-hash-1',
    }],
  },
  readiness: { status: 'READY', reasons: [], sourceCount: 1, sourceIdentityHash: 'source-hash', quantityTotal: '2.000', amountTotal: '100.000000000000' },
  versionIntegrityVerified: true,
  rowIntegrityVerified: true,
});

const makePort = (overrides: Partial<AllocationPricingBindingPort> = {}) => {
  const calls = { locks: [] as string[], references: [] as unknown[], events: [] as unknown[] };
  const port: AllocationPricingBindingPort = {
    loadCutover: async () => ({ enabled: true, cutoverAt: new Date('2026-08-09T12:00:00.000Z') }),
    lockPricingScope: async (keys) => { calls.locks.push(...keys); },
    loadLockedPricingEvidence: async () => [lockedEvidence()],
    loadPriorPricedEvents: async () => [],
    createPricingReference: async (reference) => { calls.references.push(reference); },
    createPricedEvent: async (event) => { calls.events.push(event); },
    ...overrides,
  };
  return { port, calls };
};

const input = {
  allocationRevisionId: 'revision-1', finalizedAt: new Date('2026-08-09T12:00:00.000Z'), actorId: 'logistics-1',
  lines: [{ allocationRevisionLineId: 'line-1', contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'stable-row-1', quantity: '1.000', unit: 'm2' }],
};

const main = async () => {
{
  const { port, calls } = makePort();
  const result = await bindFinalizedAllocationPricing(port, input, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' });
  assert.equal(result.path, 'ATOMIC_WAYBILL_STATEMENT');
  assert.deepEqual(calls.locks, [
    'APPROVED_PRICING_HEAD:contract-1',
    'APPROVED_PRICING_ROW:contract-1:item-1',
    'PRICED_ALLOCATION_LEDGER:pricing-row-1',
  ]);
  assert.deepEqual(calls.references, [{
    allocationRevisionId: 'revision-1', contractId: 'contract-1', pricingVersionId: 'pricing-1',
    expectedPricingHash: 'pricing-hash-1', readinessEvidenceHash: 'ready-hash-1',
  }]);
  assert.equal(calls.events.length, 1);
  const persisted = calls.events[0] as Record<string, unknown>;
  assert.deepEqual({ ...persisted, evidence: undefined, integrityHash: undefined }, {
    allocationRevisionId: 'revision-1', allocationRevisionLineId: 'line-1', pricingVersionId: 'pricing-1', pricingRowId: 'pricing-row-1',
    quantity: '1.000', grossAmount: '50.000000000000', discountAmount: '2.500000000000', netAmount: '47.500000000000',
    consumesFinalRemainder: false,
    evidence: undefined,
    integrityHash: undefined,
    recordedBy: 'logistics-1',
  });
  const event = calls.events[0] as { evidence: unknown; integrityHash: string };
  assert.equal(typeof event.evidence, 'object');
  assert.match(event.integrityHash, /^[a-f0-9]{64}$/);
}

{
  const { port, calls } = makePort();
  const result = await bindFinalizedAllocationPricing(port, { ...input, finalizedAt: new Date('2026-08-09T11:59:59.999Z') }, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' });
  assert.equal(result.path, 'LEGACY_WAYBILL_ONLY');
  assert.deepEqual(calls, { locks: [], references: [], events: [] });
}

{
  const { port, calls } = makePort();
  const result = await bindFinalizedAllocationPricing(port, input, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'false' });
  assert.equal(result.path, 'LEGACY_WAYBILL_ONLY');
  assert.deepEqual(calls.references, []);
}

for (const evidence of [
  { ...lockedEvidence(), readiness: { ...lockedEvidence().readiness, status: 'BLOCKED' as const } },
  { ...lockedEvidence(), versionIntegrityVerified: false },
  { ...lockedEvidence(), rowIntegrityVerified: false },
]) {
  const { port, calls } = makePort({ loadLockedPricingEvidence: async () => [evidence] });
  await assert.rejects(
    () => bindFinalizedAllocationPricing(port, input, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' }),
    (error: unknown) => error instanceof AllocationPricingBindingError,
  );
  assert.deepEqual(calls.references, []);
  assert.deepEqual(calls.events, []);
}

console.log('allocation pricing binding tests passed');
};

void main();
