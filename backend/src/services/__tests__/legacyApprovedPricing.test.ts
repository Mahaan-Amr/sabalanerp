import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountingRecordStatus, ApprovedPricingVersionOrigin, FinancialRecordKind } from '@prisma/client';
import {
  buildLegacyPricingManifest,
  buildLegacyPricingCandidate,
  classifyLegacyPricingCandidate,
  runLegacyPricingSeal,
  parseLegacyPricingReviews,
  loadLegacyPricingCandidates,
  sealLegacyPricingWithApprovedPricingRepository,
  type LegacyApprovedPricingWriterRepository,
  toPersistedPricingReadiness,
  type LegacyPricingCandidate,
  type LegacyPricingReview,
  type LegacyPricingSealWriter,
} from '../legacyApprovedPricing';
import type { ApprovedPricingPersistenceContext, ApprovedPricingVersionInsert } from '../approvedPricing';

const completeCandidate = (overrides: Partial<LegacyPricingCandidate> = {}): LegacyPricingCandidate => {
  const sourceFinancialRecordId = overrides.sourceFinancialRecordId ?? 'invoice-1';
  return ({
  contractId: 'contract-1',
  sourceFinancialRecordId,
  approvalLeaves: [{
    id: sourceFinancialRecordId, kind: 'INVOICE_CANDIDATE', status: 'ISSUED',
    approvedAt: '2026-08-01T08:00:00.000Z', approvedBy: 'accountant-1',
  }],
  currency: 'IRR',
  customerId: 'customer-1',
  projectId: 'project-1',
  destination: 'Tehran warehouse',
  envelopeEvidence: {
    financialCurrency: 'IRR', financialCustomerId: 'customer-1', snapshotCurrency: 'IRR',
    snapshotCustomerId: 'customer-1', snapshotProjectId: 'project-1',
  },
  discount: { enabled: true, baseAmount: '100.000000000000', amount: '10.000000000000' },
  rows: [{
    contractItemId: 'item-1', relationalProductRowId: 'row-1', snapshotProductRowId: 'row-1',
    relationalProductId: 'product-1', snapshotProductId: 'product-1', quantity: '2.000', unit: 'squareMeter',
    currencyEvidence: { contract: 'IRR', approvalSnapshot: 'IRR', productSnapshot: 'IRR', financialRecord: 'IRR' },
    quantityEvidence: { contractItem: '2.000', approvalItem: '2.000', invoiceItem: '2.000' },
    canonicalAllInTotal: '100.000000000000', discountEligible: true,
    amountEvidence: { contractItem: '100.000000000000', approvalItem: '100.000000000000', invoiceItem: '100.000000000000' },
    componentEvidence: { material: '80.000000000000', cutting: '20.000000000000', discountBasis: '100.000000000000' },
    componentEvidenceConflict: false,
    snapshotHash: 'a'.repeat(64),
  }],
  grossAmount: '100.000000000000',
  discountAmount: '10.000000000000',
  netAmount: '90.000000000000',
  sourceIdentityHash: 'b'.repeat(64),
  sourceEvidenceHash: 'c'.repeat(64),
  existingSeal: null,
  review: null,
  rowCounts: { contractItems: 1, approvalItems: 1, productSnapshots: 1, invoiceItems: 1 },
  ...overrides,
  });
};

const reviewed = (candidate: LegacyPricingCandidate): LegacyPricingReview => ({
  reviewedBy: 'reviewer-1',
  reviewedAt: '2026-08-02T08:00:00.000Z',
  sourceEvidenceHash: candidate.sourceEvidenceHash,
  decision: 'APPROVE_SEAL',
  reason: 'Independent source evidence reconciled.',
});

test('complete evidence remains review-required until an exact reviewed hash authorizes sealing', () => {
  const candidate = completeCandidate();
  const waiting = classifyLegacyPricingCandidate(candidate);
  assert.equal(waiting.status, 'LEGACY_REVIEW_REQUIRED');
  assert.deepEqual(waiting.reasons.map(reason => reason.code), ['MISSING_APPROVED_GRAPH_VERSION']);

  const ready = classifyLegacyPricingCandidate({ ...candidate, review: reviewed(candidate) });
  assert.equal(ready.status, 'READY');
  assert.deepEqual(ready.reasons, []);
  assert.equal(ready.quantityTotal, '2.000');
  assert.equal(ready.amountTotal, '90.000000000000');
});

test('missing values never become zero and are explicitly repair-required', () => {
  const candidate = completeCandidate({
    rows: [{ ...completeCandidate().rows[0], canonicalAllInTotal: null }],
    review: reviewed(completeCandidate()),
  });
  const result = classifyLegacyPricingCandidate(candidate);
  assert.equal(result.status, 'REPAIR_REQUIRED');
  assert.ok(result.reasons.some(reason => reason.code === 'MISSING_TOTAL'));
  assert.equal(result.amountTotal, null);
});

test('discount eligibility requires an explicit scale-twelve nonnegative basis', () => {
  const missing = completeCandidate({ rows: [{ ...completeCandidate().rows[0], componentEvidence: { material: '80.000000000000', cutting: '20.000000000000' } }] });
  assert.equal(classifyLegacyPricingCandidate(missing).status, 'REPAIR_REQUIRED');
  assert.ok(classifyLegacyPricingCandidate(missing).reasons.some(reason => reason.code === 'MISSING_DISCOUNT_EVIDENCE'));

  const conflicting = completeCandidate({ rows: [{ ...completeCandidate().rows[0], discountEligible: false, componentEvidence: { ...completeCandidate().rows[0].componentEvidence!, discountBasis: '1.000000000000' } }] });
  assert.equal(classifyLegacyPricingCandidate(conflicting).status, 'EVIDENCE_CONFLICT');
  assert.ok(classifyLegacyPricingCandidate(conflicting).reasons.some(reason => reason.code === 'FINANCIAL_MISMATCH'));
});

test('similar position cannot replace stable identity and contradictory evidence is quarantined', () => {
  const missing = completeCandidate({ rows: [{ ...completeCandidate().rows[0], relationalProductRowId: null }] });
  assert.equal(classifyLegacyPricingCandidate(missing).status, 'REPAIR_REQUIRED');
  assert.ok(classifyLegacyPricingCandidate(missing).reasons.some(reason => reason.code === 'MISSING_STABLE_ROW_ID'));

  const conflict = completeCandidate({ rows: [{ ...completeCandidate().rows[0], snapshotProductRowId: 'row-other' }] });
  assert.equal(classifyLegacyPricingCandidate(conflict).status, 'EVIDENCE_CONFLICT');
  assert.ok(classifyLegacyPricingCandidate(conflict).reasons.some(reason => reason.code === 'IDENTITY_CONFLICT'));
});

test('APPROVED_FOR_ISSUE and multiple valid leaves never count as approved truth', () => {
  const invalid = completeCandidate({ approvalLeaves: [{
    id: 'invoice-1', kind: 'INVOICE_CANDIDATE', status: 'APPROVED_FOR_ISSUE',
    approvedAt: '2026-08-01T08:00:00.000Z', approvedBy: 'accountant-1',
  }] });
  assert.equal(classifyLegacyPricingCandidate(invalid).status, 'REPAIR_REQUIRED');
  assert.ok(classifyLegacyPricingCandidate(invalid).reasons.some(reason => reason.code === 'APPROVAL_NOT_VALID_LEAF'));

  const duplicate = completeCandidate({ approvalLeaves: [completeCandidate().approvalLeaves[0], {
    ...completeCandidate().approvalLeaves[0], id: 'invoice-2', status: 'POSTED',
  }] });
  assert.equal(classifyLegacyPricingCandidate(duplicate).status, 'EVIDENCE_CONFLICT');
  assert.ok(classifyLegacyPricingCandidate(duplicate).reasons.some(reason => reason.code === 'MULTIPLE_VALID_APPROVALS'));
});

test('a prior seal with changed evidence is stale and can never be silently refreshed', () => {
  const candidate = completeCandidate({
    existingSeal: { pricingVersionId: 'version-1', sourceEvidenceHash: 'd'.repeat(64) },
  });
  const result = classifyLegacyPricingCandidate(candidate);
  assert.equal(result.status, 'STALE');
  assert.ok(result.reasons.some(reason => reason.code === 'HASH_MISMATCH'));
});

test('manifest is deterministic regardless of source order and contains exact totals and quarantine', () => {
  const repair = completeCandidate({ contractId: 'contract-2', sourceFinancialRecordId: 'invoice-2', rows: [{ ...completeCandidate().rows[0], quantity: null }] });
  const first = buildLegacyPricingManifest([repair, completeCandidate()]);
  const second = buildLegacyPricingManifest([completeCandidate(), repair]);
  assert.deepEqual(first, second);
  assert.equal(first.counts.LEGACY_REVIEW_REQUIRED, 1);
  assert.equal(first.counts.REPAIR_REQUIRED, 1);
  assert.equal(first.sourceContractCount, '2');
  assert.equal(first.sourceApprovalRecordCount, '2');
  assert.equal(first.quantityTotal, null);
  assert.equal(first.knownQuantitySubtotal, '2.000');
  assert.equal(first.amountTotal, '180.000000000000');
  assert.equal(first.entries[1].quarantined, true);
});

test('apply is idempotent and resumes after interruption without changing its manifest', async () => {
  const firstCandidate = completeCandidate();
  const secondBase = completeCandidate({ contractId: 'contract-2', sourceFinancialRecordId: 'invoice-2', sourceIdentityHash: 'd'.repeat(64), sourceEvidenceHash: 'e'.repeat(64) });
  const candidates = [
    { ...firstCandidate, review: reviewed(firstCandidate) },
    { ...secondBase, review: reviewed(secondBase) },
  ];
  const sealed = new Map<string, string>();
  const calls: string[] = [];
  const writer: LegacyPricingSealWriter = {
    async seal(command) {
      calls.push(command.idempotencyKey);
      const prior = sealed.get(command.idempotencyKey);
      if (prior) return { outcome: 'REPLAYED', pricingVersionId: prior };
      const id = `version-${sealed.size + 1}`;
      sealed.set(command.idempotencyKey, id);
      return { outcome: 'SEALED', pricingVersionId: id };
    },
  };

  await assert.rejects(runLegacyPricingSeal(candidates, writer, { afterEach: completed => {
    if (completed === 1) throw new Error('simulated interruption');
  } }), /simulated interruption/);
  const resumed = await runLegacyPricingSeal(candidates, writer);
  const repeated = await runLegacyPricingSeal([...candidates].reverse(), writer);
  assert.deepEqual(resumed.beforeManifest, repeated.beforeManifest);
  assert.deepEqual(resumed.results.map(item => item.outcome), ['REPLAYED', 'SEALED']);
  assert.deepEqual(repeated.results.map(item => item.outcome), ['REPLAYED', 'REPLAYED']);
  assert.equal(new Set(calls).size, 2);
});

test('source adapter binds rows only by exact stable identity and hashes the untouched approval source', () => {
  const candidate = buildLegacyPricingCandidate({
    contract: {
      id: 'contract-1', currency: 'تومان', customerId: 'customer-1',
      items: [{ id: 'item-1', productId: 'product-1', productRowId: 'row-1', quantity: '2.000', totalPrice: '100.000000000000' }],
    },
    financialRecords: [{
      id: 'invoice-1', kind: 'INVOICE_CANDIDATE', status: 'ISSUED', approvedAt: '2026-08-01T08:00:00.000Z', approvedBy: 'accountant-1',
      currency: 'ریال', customerId: 'customer-1', amount: '900.000000000000',
      sourceSnapshot: {
        currency: 'تومان', customerId: 'customer-1',
        items: [{ id: 'item-1', productId: 'product-1', quantity: '2.000', totalPrice: '100.000000000000' }],
        contractData: {
          customerId: 'customer-1', projectId: 'project-1', project: { id: 'project-1', address: 'Tehran warehouse' },
          discount: { enabled: true, baseSubtotal: '70', amount: '10' },
          products: [{
            rowId: 'row-1', productId: 'product-1', productType: 'prepared', preparedQuantity: '2', preparedUnit: 'squareMeter',
            currency: 'تومان', totalPrice: '100', originalTotalPrice: '70', isMandatory: false, mandatoryPercentage: '0', cuttingCost: '10',
            totalSubServiceCost: '10', appliedSubServices: [{ id: 'tool-1', cost: '10' }], finishingId: 'finish-1', finishingCost: '10',
          }],
        },
      },
      invoiceItems: [{ contractItemId: 'item-1', productId: 'product-1', quantity: '2.000', totalPrice: '1000.000000000000' }],
    }],
    existingSeal: null,
    review: null,
  });
  assert.equal(candidate.rows[0].snapshotProductRowId, 'row-1');
  assert.equal(candidate.currency, 'ریال');
  assert.equal(candidate.rows[0].canonicalAllInTotal, '1000.000000000000');
  assert.deepEqual(candidate.rows[0].componentEvidence, {
    material: '700.000000000000', mandatory: '0.000000000000', cutting: '100.000000000000',
    tooling: '100.000000000000', finishing: '100.000000000000', discountBasis: '700.000000000000',
  });
  assert.equal(candidate.sourceEvidenceHash.length, 64);
  assert.equal(classifyLegacyPricingCandidate(candidate).status, 'LEGACY_REVIEW_REQUIRED');

  const legacyWithoutPersistedIdentity = buildLegacyPricingCandidate({
    ...{
      contract: { id: 'contract-1', currency: 'IRR', customerId: 'customer-1', items: [{ id: 'item-1', productId: 'product-1', productRowId: null, quantity: '2', totalPrice: '100' }] },
      financialRecords: [], existingSeal: null, review: null,
    },
  });
  const result = classifyLegacyPricingCandidate(legacyWithoutPersistedIdentity);
  assert.equal(result.status, 'REPAIR_REQUIRED');
  assert.ok(result.reasons.some(item => item.code === 'MISSING_STABLE_ROW_ID'));
});

test('Prisma source cohort includes graphless contracts with no invoice candidate', async () => {
  const database = {
    salesContract: { findMany: async () => [{
      id: 'contract-without-candidate', currency: 'تومان', customerId: 'customer-1', items: [], approvedPricingVersions: [],
    }] },
    accountingFinancialRecord: { findMany: async () => [] },
  };
  const candidates = await loadLegacyPricingCandidates(database as never);
  assert.equal(candidates.length, 1);
  const classification = classifyLegacyPricingCandidate(candidates[0]);
  assert.equal(classification.status, 'REPAIR_REQUIRED');
  assert.ok(classification.reasons.some(item => item.code === 'APPROVAL_NOT_VALID_LEAF'));
});

test('every legacy reason maps to the frozen persistence contract without losing its precise code', () => {
  const classification = classifyLegacyPricingCandidate(completeCandidate({
    rows: [{ ...completeCandidate().rows[0], relationalProductRowId: null, quantity: null }],
  }));
  const persisted = toPersistedPricingReadiness(classification);
  assert.equal(persisted.status, 'BLOCKED');
  assert.ok(persisted.reasons.some(item => item.code === 'MISSING_STABLE_ROW_IDENTITY' && item.detail.legacyCode === 'MISSING_STABLE_ROW_ID'));
  assert.ok(persisted.reasons.some(item => item.code === 'MISSING_CONTRACTED_QUANTITY' && item.detail.legacyCode === 'MISSING_QUANTITY'));
});

test('review import rejects duplicate identities and any non-exact source hash', () => {
  const decision = {
    contractId: 'contract-1', sourceFinancialRecordId: 'invoice-1', reviewedBy: 'reviewer-1',
    reviewedAt: '2026-08-02T08:00:00.000Z', sourceEvidenceHash: 'a'.repeat(64),
    decision: 'APPROVE_SEAL', reason: 'Reconciled independently.',
  };
  assert.equal(parseLegacyPricingReviews([decision])[0].decision, 'APPROVE_SEAL');
  assert.throws(() => parseLegacyPricingReviews([{ ...decision, sourceEvidenceHash: 'not-a-hash' }]), /invalid sourceEvidenceHash/);
  assert.throws(() => parseLegacyPricingReviews([decision, decision]), /duplicate source identities/);
});

test('post-seal recapture returns a failed before/after manifest with explicit differences', async () => {
  const candidate = completeCandidate();
  const ready = { ...candidate, review: reviewed(candidate) };
  const writer: LegacyPricingSealWriter = { async seal() { return { outcome: 'SEALED', pricingVersionId: 'version-1' }; } };
  const run = await runLegacyPricingSeal([ready], writer, {
    recapture: async () => [{ ...ready, sourceEvidenceHash: 'f'.repeat(64) }],
  });
  assert.equal(run.status, 'FAILED');
  assert.equal(run.reason, 'SOURCE_EVIDENCE_CHANGED_DURING_SEALING');
  assert.equal(run.sourceComparison.matched, false);
  assert.ok(run.sourceComparison.differences.includes('SOURCE_EVIDENCE_HASH'));
  assert.notEqual(run.beforeManifest.manifestHash, run.afterManifest.manifestHash);
  assert.deepEqual(run.outcomeCounts, { SEALED: 1, REPLAYED: 0 });
});

test('real legacy writer port persists through approvedPricing with LEGACY_SEAL context and replays by source identity', async () => {
  const candidate = completeCandidate();
  const ready = { ...candidate, review: reviewed(candidate) };
  let persisted: ApprovedPricingVersionInsert | null = null;
  let persistenceContext: ApprovedPricingPersistenceContext | null = null;
  const repository: LegacyApprovedPricingWriterRepository = {
    async readApprovalLeaf() { return {
      id: 'invoice-1', contractId: 'contract-1', kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.ISSUED,
      financiallyApprovedAt: new Date('2026-08-01T08:00:00.000Z'), financiallyApprovedBy: 'accountant-1',
      amount: '90', currency: 'IRR', sourceId: 'contract-1', sourceSnapshot: {}, metadata: {}, invoiceItems: [],
    }; },
    async withContractLock<T>(_contractId: string, work: () => Promise<T>) { return work(); },
    async findByApproval() { return persisted; },
    async readPersistenceContext() { return persisted ? { origin: ApprovedPricingVersionOrigin.LEGACY_SEAL, legacySourceReference: { sourceEvidenceHash: ready.sourceEvidenceHash } } : null; },
    async loadSource() { return null; },
    async nextVersionNumber() { return 1; },
    async insertAndAdvance(version: ApprovedPricingVersionInsert, context?: ApprovedPricingPersistenceContext) {
      persisted = version; persistenceContext = context ?? null; return version;
    },
  };
  const command = {
    idempotencyKey: 'command-1', origin: 'LEGACY_SEAL' as const, candidate: ready, review: ready.review!,
    sourceReference: { contractId: ready.contractId, sourceFinancialRecordId: ready.sourceFinancialRecordId, sourceIdentityHash: ready.sourceIdentityHash, sourceEvidenceHash: ready.sourceEvidenceHash },
  };
  const first = await sealLegacyPricingWithApprovedPricingRepository(repository, command, { version: () => 'version-1', row: () => 'pricing-row-1' });
  const replay = await sealLegacyPricingWithApprovedPricingRepository(repository, command);
  assert.deepEqual(first, { outcome: 'SEALED', pricingVersionId: 'version-1' });
  assert.deepEqual(replay, { outcome: 'REPLAYED', pricingVersionId: 'version-1' });
  assert.equal((persistenceContext as ApprovedPricingPersistenceContext | null)?.origin, ApprovedPricingVersionOrigin.LEGACY_SEAL);
  assert.equal((persisted as ApprovedPricingVersionInsert | null)?.rows[0]?.componentEvidence.discountBasis, '100.000000000000');
});
