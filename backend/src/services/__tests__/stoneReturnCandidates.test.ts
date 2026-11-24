import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { publishInventoryValuationEvidencePrisma } from '../accountingCustomerTreasuryPrisma';
import { hashAccountingEvidence } from '../accountingLedgerFoundation';
import { hashCustomerTreasuryEvidence } from '../accountingCustomerTreasury';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { loadStoneReturnCandidates } from '../stoneReturnCandidates';

const at = new Date('2026-10-01T02:00:00Z');
const receipt = {
  customerId: 'customer', productId: 'stone', unit: 'squareMeter', acceptedQuantity: '35',
  guardReturnMovementId: null, createdAt: new Date('2026-10-10T02:00:00Z'),
};

function fixture() {
  const lineIdentity = { contractId: 'contract', contractItemId: 'item', productRowId: 'row', productId: 'stone',
    quantity: '30.000', unit: 'squareMeter', snapshot: { productId: 'stone' } };
  const revisionSnapshot = { loading: { id: 'loading', number: '1111', customer: { id: 'customer' } }, lines: [lineIdentity] };
  const revision = { id: 'revision', loadingId: 'loading', sourceKind: 'SALES_CONTRACT', snapshot: revisionSnapshot,
    integrityHash: hashAccountingEvidence(revisionSnapshot),
    lines: [{ id: 'allocation', revisionId: 'revision', sourceKind: 'SALES_CONTRACT', sourceContractId: 'contract',
      sourceContractItemId: 'item', ...lineIdentity, quantity: new Prisma.Decimal(lineIdentity.quantity),
      integrityHash: hashAccountingEvidence({ revisionId: 'revision', ...lineIdentity }) }] };
  const exitSnapshot = { allocationRevisionId: 'revision', allocationIntegrityHash: revision.integrityHash, occurredAt: at };
  const exit = { id: 'exit', occurredAt: at, snapshot: exitSnapshot, integrityHash: hashAccountingEvidence(exitSnapshot),
    allocationRevision: revision };
  const dispatchCanonical = { id: 'dispatch', contractId: 'contract', contractItemId: 'item', productRowId: 'row',
    kind: 'PHYSICAL_EXIT' as const, unit: 'squareMeter', quantity: '30.000', effectiveAt: at.toISOString(), recordedAt: at.toISOString(),
    sourceType: 'GUARD_PHYSICAL_EXIT', sourceId: 'exit:allocation', sourceVersion: 1, integrityHash: '',
    metadata: { loadingId: 'loading', physicalExitId: 'exit', allocationLineId: 'allocation', allocationRevisionId: 'revision' } };
  const dispatch = { ...dispatchCanonical, sourceKind: 'SALES_CONTRACT', quantity: new Prisma.Decimal('30'), effectiveAt: at,
    recordedAt: at, contractItem: { contractId: 'contract', productRowId: 'row' }, linkedReturns: [], integrityHash: shipmentQuantityEvidenceIntegrityHash(dispatchCanonical) };
  const evidence = { id: 'exit', version: 1, type: 'GUARD_EXIT', contractId: 'contract', contractVersion: 1, occurredAt: at,
    productRows: [{ id: 'row', quantity: '30.000' }] };
  const controlEvidenceHash = hashCustomerTreasuryEvidence(evidence);
  const voucherSource = { evidence: { ...evidence, hash: controlEvidenceHash } };
  const original = { id: 'inv', number: 'INV-222', taxInvoiceId: 'tax-inv', ledgerVoucherId: 'voucher', contractId: 'contract',
    contractVersion: 1, controlEvidenceId: 'exit', controlEvidenceVersion: 1, controlEvidenceType: 'GUARD_EXIT',
    controlEvidenceHash, issuedAt: at, profile: { legalEntityId: 'entity', partySourceKind: 'CUSTOMER', partySourceId: 'customer' } };
  const taxLine = { id: 'tax-line', sourceLineId: 'source-line', productRowId: 'row', quantity: new Prisma.Decimal('30'),
    rawBaseAmount: new Prisma.Decimal('36000000'), allocationEvidence: {} };
  const db = {
    contractItem: { findMany: async () => [{ id: 'item', contractId: 'contract', productRowId: 'row', productId: 'stone',
      contract: { id: 'contract', contractNumber: 'C-333', customerId: 'customer' } }] },
    accountingCommercialCustomerInvoice: { findMany: async () => [original] },
    accountingLedgerVoucher: { findMany: async () => [{ id: 'voucher', bookId: 'book', book: { legalEntityId: 'entity' },
      sourceType: 'CONTROL_TRANSFER', sourceId: 'exit', sourceVersion: 1, sourcePayload: voucherSource,
      sourceHash: hashAccountingEvidence(voucherSource) }] },
    accountingTaxInvoice: { findMany: async () => [{ id: 'tax-inv', commercialInvoiceId: 'inv', ledgerVoucherId: 'voucher', lines: [taxLine] }] },
    guardPhysicalExit: { findMany: async () => [exit] },
    shipmentQuantityEvidence: {
      findMany: async (query: { where: { dispatchEvidenceId?: string } }) => query.where.dispatchEvidenceId ? [] : [dispatch],
      findUnique: async () => dispatch,
    },
    accountingReturnEvidenceConsumption: { groupBy: async () => [
      { originalInvoiceId: 'inv', originalLineId: 'source-line', _sum: { quantity: new Prisma.Decimal('5.125') } },
    ] },
  };
  return { tx: db as unknown as Prisma.TransactionClient, dispatch, original, exit };
}

test('shows the immutable contract and invoice, original net rate and exact available quantity', async () => {
  const { tx } = fixture();
  const result = await loadStoneReturnCandidates(tx, receipt);
  assert.equal(result.originKnown, false);
  assert.equal(result.candidates.length, 1);
  const row = result.candidates[0];
  assert.equal(row.contractNumber, 'C-333');
  assert.equal(row.originalInvoiceNumber, 'INV-222');
  assert.equal(row.originalNetRateRials, '1200000');
  assert.equal(row.deliveredQuantity, '30.000');
  assert.equal(row.linePriorReturnedQuantity, '5.125');
  assert.equal(row.remainingQuantity, '24.875');
});


test('does not expose a dispatch from another unit or a foreign CRM customer', async () => {
  const unit = fixture();
  assert.equal((await loadStoneReturnCandidates(unit.tx, { ...receipt, unit: 'count' })).candidates.length, 0);
  const account = fixture();
  account.original.profile.partySourceId = 'other-customer';
  assert.equal((await loadStoneReturnCandidates(account.tx, receipt)).candidates.length, 0);
});

test('does not substitute a same-stone loading when the original dispatch evidence is broken', async () => {
  const { tx, exit } = fixture();
  exit.integrityHash = 'tampered';
  const result = await loadStoneReturnCandidates(tx, receipt);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.hasUnlinkedOriginals, true);
});

test('shows an unresolved origin for a delivered sale without a recognized original invoice', async () => {
  const { tx, dispatch } = fixture();
  Object.assign(tx.accountingCommercialCustomerInvoice, { findMany: async () => [] });
  Object.assign(tx.shipmentQuantityEvidence, { findFirst: async () => dispatch });
  const result = await loadStoneReturnCandidates(tx, receipt);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.hasUnlinkedOriginals, true);
});


test('publishes original valuation for a physical exit with a canonical persisted quantity', async () => {
  const { dispatch } = fixture();
  const tx = {
    $executeRaw: async () => 1,
    shipmentQuantityEvidence: { findUnique: async () => ({ ...dispatch, returnEvidenceId: null,
      contractItem: { ...dispatch.contractItem, product: { stoneTypeCode: 'granite' } } }) },
    inventoryValuationEvidence: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => create,
    },
  };
  const db = { $transaction: async (task: (transaction: typeof tx) => Promise<unknown>) => task(tx) } as unknown as PrismaClient;
  const valuation = await publishInventoryValuationEvidencePrisma(db, {
    shipmentQuantityEvidenceId: dispatch.id, valuationMethod: 'SPECIFIC_IDENTIFICATION', valuationVersion: 1,
    inventoryDocumentId: 'warehouse-doc', unitCostRials: 2n, actorId: 'accountant',
  });
  assert.equal(valuation.shipmentQuantityEvidenceId, dispatch.id);
  assert.equal(String(valuation.totalCostRials), '60');
});
