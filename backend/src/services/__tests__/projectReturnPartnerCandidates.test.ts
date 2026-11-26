import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import type { Prisma } from '@prisma/client';
import { buildCaseProjections } from '../partnerSales/cases/projections';
import { projectionEvidence } from '../partnerSales/cases/lifecycle';
import { loadProjectReturnFinancialCandidates } from '../projectReturnFinancialCandidates';
import { historicalAccountingFixture } from './partnerAccountingHistoricalReadFixture';

test('a Partner financial approval follows its unchanged owned row through receipt and head revisions', async () => {
  const projectId = 'return-project';
  const customerId = 'return-customer';
  const fixture = await historicalAccountingFixture('ISSUED', { projectId });
  const { row, revision } = fixture;
  const preparation = fixture.invoice.sourceSnapshot.partnerPreparation;
  const [product] = preparation.products;
  const approvedAt = '2026-10-01T08:00:00.000Z';
  const financialApprovalEvidenceId = `partner-financial-approval:${(await canonicalHash({
    invoiceRecordId: fixture.invoice.id, evidenceHash: preparation.evidenceHash, actorId: 'accountant', approvedAt,
  })).slice(10)}`;
  const invoice = { ...fixture.invoice, financiallyApprovedAt: new Date(approvedAt), financiallyApprovedBy: 'accountant',
    systemInvoiceDate: new Date(approvedAt), systemInvoiceNumber: 'QA-PARTNER-515', _count: { receivables: 0 },
    metadata: { ...fixture.invoice.metadata, partnerReceivablePending: true, partnerApproval: {
      actorId: 'accountant', recordedAt: approvedAt, effectiveDate: '2026-10-01', financialApprovalEvidenceId,
    } } };
  const successor = async (quantity: string) => {
    const wholesaleEnvelope = { ...revision.wholesaleEnvelope,
      products: [{ ...revision.wholesaleEnvelope.products[0], quantity }] };
    const evidence = {
      graphHash: revision.graphHash, graph: revision.graph, partySnapshots: revision.partySnapshots,
      wholesaleEnvelope, retailEnvelope: revision.retailEnvelope, paymentEvidence: revision.paymentEvidence,
      customerContent: { ...revision.customerContent, legalText: 'Updated retail contract text' },
    };
    const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
      predecessor: { revision: 1, integrityHash: revision.integrityHash }, ...evidence });
    const projected = await buildCaseProjections({
      caseId: row.id, revision: 2, integrityHash, caseNumber: row.caseNumber, internalRecordId: row.internalRecordId,
      internalRecordNumber: row.internalRecord.recordNumber, customerContractNumber: row.customerContract.contractNumber,
      commercialAccountId: row.internalRecord.commercialAccountId, state: 'DRAFT',
      evidence: projectionEvidence(evidence as unknown as Parameters<typeof projectionEvidence>[0])!,
    });
    assert.ok(projected.ok, JSON.stringify(projected));
    const { partner, accounting, fulfillment, customer } = projected.value;
    return { ...row, headRevision: 2, integrityHash,
      head: { ...revision, ...evidence, integrityHash, predecessorRevision: 1,
        internalProjection: { partner, accounting, fulfillment }, customerProjection: customer },
      internalRecord: { ...row.internalRecord, expectedRevision: 2, integrityHash },
      customerContract: { ...row.customerContract, partnerRevision: 2, partnerIntegrityHash: integrityHash },
    };
  };
  let current = await successor(product.quantity);
  const overrides = {
    contractItem: { findMany: async () => [] },
    partnerSaleCase: {
      findUnique: async () => current,
      findMany: async () => [{ ...current, createdAt: new Date(approvedAt), profile: { user: { firstName: 'QA', lastName: 'Partner' } } }],
    },
    partnerCaseRevision: { findUnique: async ({ where }: { where: { caseId_revision: { revision: number } } }) =>
      ({ 1: revision, 2: current.head }[where.caseId_revision.revision] ?? null) },
    accountingFinancialRecord: { findMany: async () => [invoice] },
  };
  const tx = new Proxy(fixture.tx, {
    get: (target, name) => name in overrides ? overrides[name as keyof typeof overrides] : Reflect.get(target, name),
  }) as Prisma.TransactionClient;
  const load = (partnerRevision: number) => loadProjectReturnFinancialCandidates(tx, {
    customerId, productId: 'fixture-stone', unit: product.unit === 'm' ? 'meter' : product.unit,
    projectIds: [projectId], before: new Date('2026-10-02T08:00:00.000Z'),
    contractSources: [{ projectId, contractId: row.customerContractId, partnerCaseId: row.id,
      partnerRevision, productRowId: product.productRowId }],
  }, []);
  const [unchanged] = await load(2);
  assert.equal(unchanged?.financialLineId, product.productRowId);
  assert.deepEqual(unchanged.financialParty, { kind: 'PARTNER', id: row.internalRecord.commercialAccountId });
  assert.equal(unchanged.linePriorReturnedQuantity, null);
  assert.deepEqual(await load(3), [], 'An unproven captured revision is ineligible');
  current = await successor('3');
  assert.deepEqual(await load(2), [], 'The old approval cannot price a materially different current row');
  assert.deepEqual(await load(1), [], 'The old captured revision cannot override a materially different head');
});
