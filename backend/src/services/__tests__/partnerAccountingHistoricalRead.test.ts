import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerAccountingCommandError } from '../partnerSales/accounting/errors';
import { PartnerSabalanPlanIntegrityError } from '../partnerSales/accounting/sabalanPlan';
import { historicalAccountingFixture as fixture, writerBoundAccountingFixture } from './partnerAccountingHistoricalReadFixture';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { projectionEvidence } from '../partnerSales/cases/lifecycle';
import { buildCaseProjections } from '../partnerSales/cases/projections';
import { readPartnerInvoiceSource } from '../partnerSales/accounting/invoiceSource';
for (const status of ['DRAFT', 'ISSUED', 'POSTED']) {
  test(`${status} historical invoice reads survive valid empty plan version 3 to 4 drift without changing financial history`, async () => {
    const f = await fixture(status);
    const before = structuredClone({ invoice: f.invoice, revision: f.revision, plan: f.persistedPlan });
    await f.read();
    assert.deepEqual({ invoice: f.invoice, revision: f.revision, plan: f.persistedPlan }, before);
    assert.equal(f.writes.length, 2);
    assert.ok(f.writes.every(write => write === 'AUTHORIZATION_AUDIT'));
  });
}

for (const advance of [false, true]) {
  test(`writer-bound nonempty invoice plan reads with notes and ${advance ? 'later version 5' : 'current version 4'}`, async () => {
    const f = await writerBoundAccountingFixture(advance);
    const before = structuredClone({ invoice: f.invoice, bound: f.boundPlan, current: f.persistedPlan });
    await f.read();
    await readPartnerInvoiceSource(f.tx, f.invoice as never, f.row.id);
    assert.deepEqual({ invoice: f.invoice, bound: f.boundPlan, current: f.persistedPlan }, before);
  });
}

for (const corruption of ['missing', 'hash', 'crossCase', 'futureRevision', 'purpose', 'version', 'effectiveDate',
  'installmentAmount', 'installmentEvidence', 'predecessor', 'snapshotTerms'] as const) {
  test(`writer-bound historical plan rejects ${corruption} in both accounting readers`, async () => {
    const f = await writerBoundAccountingFixture(true);
    if (corruption === 'missing') f.storedPlans.delete(f.boundPlan.id);
    if (corruption === 'hash') f.boundPlan.integrityHash = `sha256-v1:${'b'.repeat(64)}`;
    if (corruption === 'crossCase') f.boundPlan.caseId = 'wrong-case';
    if (corruption === 'purpose') f.boundPlan.purpose = 'RETAIL';
    if (corruption === 'version') f.boundPlan.version = 6;
    if (corruption === 'effectiveDate') f.boundPlan.effectiveDate = new Date('2030-01-01');
    if (corruption === 'futureRevision') {
      f.boundPlan.caseRevision = 2;
      f.boundPlan.integrityHash = await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
        caseId: f.row.id, revision: 2, plan: f.boundPlan.evidence });
    }
    if (corruption === 'installmentAmount') (f.boundPlan.installments[0] as { amount: string }).amount = '1';
    if (corruption === 'installmentEvidence') (f.boundPlan.installments[0] as { evidence: unknown }).evidence = {};
    if (corruption === 'predecessor') f.boundPlan.predecessor.version = 1;
    if (corruption === 'snapshotTerms') f.invoice.sourceSnapshot.partnerPreparation.paymentPlan.installments[0].amount.amount = '1';
    for (const read of [f.read, () => readPartnerInvoiceSource(f.tx, f.invoice as never, f.row.id)]) {
      await assert.rejects(read, error => error instanceof PartnerSabalanPlanIntegrityError ||
        error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT');
    }
  });
}

for (const corruption of ['total', 'currency'] as const) {
  test(`current plan with a valid hash still rejects invalid installment ${corruption}`, async () => {
    const f = await fixture();
    const installment = { installmentId: 'invalid-current-installment', dueDate: f.persistedPlan.evidence.effectiveDate,
      amount: { amount: corruption === 'total' ? '1' : f.invoice.amount, currency: corruption === 'currency' ? 'IRT' : f.invoice.currency },
      method: 'CASH' as const };
    f.persistedPlan.evidence.installments.push(installment as never);
    f.persistedPlan.installments.push({ id: installment.installmentId, dueDate: new Date(installment.dueDate),
      amount: installment.amount.amount, currency: installment.amount.currency, method: installment.method, evidence: installment } as never);
    f.persistedPlan.integrityHash = await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
      caseId: f.row.id, revision: 1, plan: f.persistedPlan.evidence });
    await assert.rejects(f.read, error => error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT');
  });
}

test('a verified later Case head with changed totals does not overwrite historical invoice preparation', async () => {
  const f = await fixture();
  const head = structuredClone(f.revision);
  head.wholesaleEnvelope.products[0].wholesaleUnitPrice = '900';
  head.wholesaleEnvelope.totals.net = '1800';
  head.wholesaleEnvelope.totals.payable = '1800';
  const { integrityHash: _oldHash, pricingState: _pricing, predecessorRevision: _predecessor,
    internalProjection: _internal, customerProjection: _customer, ...evidence } = head;
  const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
    predecessor: { revision: 1, integrityHash: f.revision.integrityHash }, ...evidence });
  const projected = await buildCaseProjections({ caseId: f.row.id, revision: 2, integrityHash,
    caseNumber: f.row.caseNumber, internalRecordId: f.row.internalRecordId,
    internalRecordNumber: f.row.internalRecord.recordNumber, customerContractNumber: f.row.customerContract.contractNumber,
    commercialAccountId: f.row.internalRecord.commercialAccountId, state: 'DRAFT', evidence: projectionEvidence(evidence as never)! });
  assert.ok(projected.ok);
  assert.ok(projected.value.accounting);
  f.row.head = { ...head, predecessorRevision: 1 as never, integrityHash,
    internalProjection: { partner: projected.value.partner, accounting: projected.value.accounting, fulfillment: projected.value.fulfillment },
    customerProjection: projected.value.customer };
  f.row.headRevision = 2; f.row.integrityHash = integrityHash;
  f.row.internalRecord.expectedRevision = 2; f.row.internalRecord.integrityHash = integrityHash;
  f.row.customerContract.partnerRevision = 2; f.row.customerContract.partnerIntegrityHash = integrityHash;
  const before = structuredClone(f.invoice);
  await f.read();
  assert.deepEqual(f.invoice, before);
});

for (const corruption of ['amount', 'currency', 'preparationHash', 'owner', 'projection', 'currentPlanHash'] as const) {
  test(`historical invoice read still rejects ${corruption} corruption`, async () => {
    const f = await fixture();
    if (corruption === 'amount') f.invoice.amount = '999999';
    if (corruption === 'currency') f.invoice.currency = 'IRT';
    if (corruption === 'preparationHash') f.invoice.sourceSnapshot.partnerPreparation.evidenceHash = `sha256-v1:${'b'.repeat(64)}`;
    if (corruption === 'owner') f.invoice.sourceSnapshot.partnerPreparation.owner.caseId = 'wrong-case';
    if (corruption === 'projection') f.revision.internalProjection.accounting!.totals.payable = '999999';
    if (corruption === 'currentPlanHash') f.persistedPlan.integrityHash = `sha256-v1:${'b'.repeat(64)}`;
    await assert.rejects(f.read, error => corruption === 'currentPlanHash'
      ? error instanceof PartnerSabalanPlanIntegrityError
      : error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT');
  });
}
