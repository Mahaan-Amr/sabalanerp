import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { readBoundPricedAllocation } from '../allocationPricingReadModel';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';

const evidence = { ledgerSequence: 4, schemaVersion: 1 };
const payload = {
  allocationRevisionId: 'revision-1', allocationRevisionLineId: 'line-1', pricingVersionId: 'version-1',
  pricingRowId: 'pricing-row-1', quantity: '1.250', grossAmount: '12.500000000000',
  discountAmount: '2.500000000000', netAmount: '10.000000000000', consumesFinalRemainder: false,
  evidence, recordedBy: 'logistics-1',
};
const event = {
  id: 'event-1', ...payload,
  quantity: new Prisma.Decimal(payload.quantity), grossAmount: new Prisma.Decimal(payload.grossAmount),
  discountAmount: new Prisma.Decimal(payload.discountAmount), netAmount: new Prisma.Decimal(payload.netAmount),
  integrityHash: pricedAllocationIntegrityHash(payload), recordedAt: new Date(),
  allocationRevisionLine: { id: 'line-1', sourceContractId: 'contract-1', sourceContractItemId: 'item-1',
    productRowId: 'stable-row-1', unit: 'm2' },
};
const tx = {
  logisticsAllocationRevisionPricing: { findMany: async () => [{
    contractId: 'contract-1', pricingVersionId: 'version-1', expectedPricingHash: 'version-hash',
    readinessEvidenceHash: 'ready-hash', pricingVersion: { currency: 'TOMAN', integrityHash: 'version-hash' },
  }] },
  dispatchPricedAllocationEvent: { findMany: async () => [event] },
};

const main = async () => {
  const model = await readBoundPricedAllocation(tx as never, 'revision-1');
  assert.equal(model.currency, 'TOMAN');
  assert.equal(model.lines[0].ledgerSequence, 4);
  assert.deepEqual(model.totals, {
    grossAmount: '12.500000000000', discountAmount: '2.500000000000', netAmount: '10.000000000000',
  });
  await assert.rejects(() => readBoundPricedAllocation({
    ...tx,
    dispatchPricedAllocationEvent: { findMany: async () => [{ ...event, integrityHash: '0'.repeat(64) }] },
  } as never, 'revision-1'), /failed integrity verification/);
};

void main().then(() => console.log('allocation pricing read model tests passed'));
