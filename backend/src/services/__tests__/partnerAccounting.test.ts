import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { preparePartnerFinancialSource } from '../partnerSales/accounting/source';
import { createPartnerAccountingAdapter } from '../partnerSales/accounting/adapter';
import { PartnerAccountingFixture } from './partnerAccountingFixture';

test('financial preparation keeps the Partner debtor, approved wholesale and Sabalan terms', async () => {
  const fixture = createPartnerFixtures();
  const source = { view: { ...fixture.accounting, state: 'COMMITTED' as const }, partnerSellerId: fixture.case.partnerSellerId };
  const result = await preparePartnerFinancialSource(source, fixture.case.head);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.debtor.partnerSellerId, 'fixture-313-partner');
  assert.equal(result.value.debtor.commercialAccountId, 'fixture-313-account');
  assert.deepEqual(result.value.amount, { amount: '1600', currency: 'IRR' });
  assert.equal(result.value.paymentPlan.installments[0].dueDate, '2026-08-28');
  assert.equal(result.value.products[0].productRowId, 'fixture-313-row');
  assert.equal(result.value.products[0].wholesaleUnitPrice, '800');
});

test('commitment queues once and does not create an official receivable', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const first = await adapter.enqueueCommitted(fixture.source.view, fixture.commitment);
  assert.equal(first.ok, true);
  assert.deepEqual(await adapter.enqueueCommitted(fixture.source.view, fixture.commitment), first);
  assert.equal(fixture.queues.length, 1);
  assert.equal(fixture.receivables.length, 0);
});

test('only official financial approval creates one Partner receivable with the Accounting effective date', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const draft = await fixture.invoice(false);
  const denied = await adapter.acceptFinancialApproval(fixture.source.view.owner, draft.invoiceRecordId);
  assert.equal(denied.ok, false);
  assert.equal(fixture.receivables.length, 0);
  fixture.invoices = [];
  const invoice = await fixture.invoice();
  const accepted = await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  assert.equal(accepted.ok, true);
  assert.deepEqual(await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId), accepted);
  assert.equal(fixture.receivables.length, 1);
  assert.equal(fixture.receivables[0].partnerSellerId, 'fixture-313-partner');
  assert.equal(fixture.receivables[0].commercialAccountId, 'fixture-313-account');
  assert.deepEqual(fixture.receivables[0].originalAmount, { amount: '1600', currency: 'IRR' });
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].effectiveDate, '2026-08-28');
  assert.equal(fixture.events[0].recordedAt, '2026-08-29T09:00:00.000Z');
});

test('own account replaces pending debt with official truth and strips internal notes', async () => {
  const fixture = new PartnerAccountingFixture();
  fixture.source.view.sabalanPaymentPlan.installments[0].notes = 'private accounting mechanics';
  const adapter = createPartnerAccountingAdapter(fixture);
  const pending = await adapter.readOwnAccount(fixture.source.partnerSellerId);
  assert.equal(pending.ok, true);
  if (!pending.ok) return;
  assert.equal(pending.value.purchases[0].status, 'AWAITING_REVIEW');
  assert.equal(JSON.stringify(pending.value).includes('private accounting mechanics'), false);
  const invoice = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  fixture.purchases = [{ source: fixture.source, official: { invoice, receivable: fixture.receivables[0],
    received: { amount: '300', currency: 'IRR' }, balance: { amount: '1300', currency: 'IRR' }, status: 'PARTIALLY_PAID' } }];
  const account = await adapter.readOwnAccount(fixture.source.partnerSellerId);
  assert.equal(account.ok, true);
  if (!account.ok) return;
  assert.equal(account.value.purchases.length, 1);
  assert.equal(account.value.purchases[0].amount.amount, '1600');
  assert.equal(account.value.purchases[0].balance.amount, '1300');
  assert.equal(account.value.purchases[0].status, 'PARTIALLY_PAID');
  assert.equal(JSON.stringify(account.value).includes('invoice'), false);
  assert.equal(JSON.stringify(account.value).includes('private accounting mechanics'), false);
  assert.equal((await adapter.readOwnAccount('another-partner')).ok, false);
});

test('check receipt and dated correction events come from saved Accounting evidence', async () => {
  const fixture = new PartnerAccountingFixture();
  const invoice = await fixture.invoice();
  const identity = invoice.approval!;
  const adapter = createPartnerAccountingAdapter(fixture);
  fixture.facts.set('check', { kind: 'RECEIPT', identity: { ...identity, eventId: 'fixture-322-check-clear' },
    owner: fixture.source.view.owner, internalRecordId: fixture.source.view.recordId, partnerSellerId: fixture.source.partnerSellerId,
    accountingReceiptId: 'fixture-322-check', amount: { amount: '400', currency: 'IRR' },
    method: 'CHECK', status: 'RECEIVED', checkStatus: 'RECEIVED' });
  assert.equal((await adapter.publishAccountingFact(fixture.source.view.owner, 'check')).ok, false);
  const check = fixture.facts.get('check')!;
  if (check.kind !== 'RECEIPT') throw new Error('Wrong fixture');
  check.checkStatus = 'CLEARED';
  check.status = 'RECONCILED';
  assert.equal((await adapter.publishAccountingFact(fixture.source.view.owner, 'check')).ok, true);
  assert.equal(fixture.events[0].type, 'SABALAN_RECEIPT');
  fixture.facts.set('correction', { kind: 'ADJUSTMENT', identity: { ...identity, eventId: 'fixture-322-correction', effectiveDate: '2026-09-03' },
    owner: fixture.source.view.owner, internalRecordId: fixture.source.view.recordId, partnerSellerId: fixture.source.partnerSellerId,
    originalRealizationEventId: fixture.commitment.eventId, correctionId: 'fixture-322-correction', delta: '-200', currency: 'IRR', reason: 'اصلاح مقدار فروش' });
  const before = structuredClone(fixture.commitment);
  assert.equal((await adapter.publishAccountingFact(fixture.source.view.owner, 'correction')).ok, true);
  assert.equal(fixture.events[1].type, 'SABALAN_ADJUSTMENT');
  assert.equal(fixture.events[1].effectiveDate, '2026-09-03');
  assert.deepEqual(fixture.commitment, before);
});

test('stale, tampered, uncommitted and cross-owner sources fail closed before writes', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  assert.equal((await adapter.prepareFinancialRecord({ ...fixture.source.view.owner, revision: 2 })).ok, false);
  assert.equal((await adapter.prepareFinancialRecord({ ...fixture.source.view.owner, integrityHash: 'sha256-v1:' + 'b'.repeat(64) })).ok, false);
  assert.equal((await adapter.enqueueCommitted({ ...fixture.source.view, recordId: 'other-record' }, fixture.commitment)).ok, false);
  fixture.source.view.state = 'CUSTOMER_APPROVED';
  assert.equal((await adapter.prepareFinancialRecord(fixture.source.view.owner)).ok, false);
  fixture.source.view.state = 'COMMITTED';
  fixture.denial = 'FORBIDDEN';
  assert.equal((await adapter.enqueueCommitted(fixture.source.view, fixture.commitment)).ok, false);
  assert.equal(fixture.queues.length + fixture.receivables.length + fixture.events.length, 0);
});

test('parallel approval retries yield one receivable and event; event failure rolls back both', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  fixture.failEventWrite = true;
  await assert.rejects(adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId));
  assert.equal(fixture.receivables.length + fixture.events.length, 0);
  fixture.failEventWrite = false;
  const results = await Promise.all(Array.from({ length: 5 }, () => adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId)));
  assert.ok(results.every(result => result.ok));
  assert.equal(fixture.receivables.length, 1);
  assert.equal(fixture.events.length, 1);
});

test('retail price, discount, tax and customer nonpayment never enter financial preparation', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const before = await adapter.prepareFinancialRecord(fixture.source.view.owner);
  fixture.fixtures.partner.retailTotals = { net: '9000', discount: '8500', tax: '500', charges: '200', payable: '1200', currency: 'IRT' };
  fixture.fixtures.customer.customerPaymentPlan.installments[0].dueDate = '2028-01-01';
  fixture.fixtures.partner.products[0].retailUnitPrice = '5';
  assert.deepEqual(await adapter.prepareFinancialRecord(fixture.source.view.owner), before);
  const polluted = { ...fixture.source.view, retailReceipts: [{ amount: '1600' }] };
  assert.equal((await adapter.enqueueCommitted(polluted, fixture.commitment)).ok, false);
});

test('payment reconciliation is exact and currency mismatches or duplicate installments reject', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const view = fixture.source.view;
  view.totals.payable = '9007199254740993.01';
  view.sabalanPaymentPlan.installments[0].amount.amount = '9007199254740993.01';
  assert.equal((await adapter.prepareFinancialRecord(view.owner)).ok, true);
  view.sabalanPaymentPlan.installments[0].amount.amount = '9007199254740993.02';
  assert.equal((await adapter.prepareFinancialRecord(view.owner)).ok, false);
  view.sabalanPaymentPlan.installments[0].amount.amount = view.totals.payable;
  view.sabalanPaymentPlan.installments[0].amount.currency = 'IRT';
  assert.equal((await adapter.prepareFinancialRecord(view.owner)).ok, false);
  view.sabalanPaymentPlan.installments[0].amount.currency = 'IRR';
  view.sabalanPaymentPlan.installments.push(structuredClone(view.sabalanPaymentPlan.installments[0]));
  assert.equal((await adapter.prepareFinancialRecord(view.owner)).ok, false);
});

test('replacement requires predecessor voiding and leaves old invoice, receipt and event evidence unchanged', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const first = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, first.invoiceRecordId);
  const previous = structuredClone({ invoice: first, receivable: fixture.receivables[0], event: fixture.events[0] });
  fixture.source.view.owner = { ...fixture.source.view.owner, revision: 2, integrityHash: 'sha256-v1:' + 'b'.repeat(64) };
  fixture.source.view.totals.payable = '1400';
  fixture.source.view.sabalanPaymentPlan.installments[0].amount.amount = '1400';
  const replacement = await fixture.invoice();
  replacement.invoiceRecordId = 'fixture-322-replacement';
  replacement.approval!.eventId = 'fixture-322-replacement-approval';
  replacement.approval!.effectiveDate = '2026-09-02';
  assert.equal((await adapter.acceptFinancialApproval(fixture.source.view.owner, replacement.invoiceRecordId)).ok, false);
  fixture.voidedReceivableIds.add(fixture.receivables[0].id);
  assert.equal((await adapter.acceptFinancialApproval(fixture.source.view.owner, replacement.invoiceRecordId)).ok, true);
  assert.deepEqual({ invoice: first, receivable: fixture.receivables[0], event: fixture.events[0] }, previous);
  fixture.purchases = [{ source: fixture.source, official: { invoice: replacement, receivable: fixture.receivables[1],
    received: { amount: '300', currency: 'IRR' }, balance: { amount: '1100', currency: 'IRR' }, status: 'PARTIALLY_PAID' } }];
  const account = await adapter.readOwnAccount(fixture.source.partnerSellerId);
  assert.equal(account.ok, true);
  if (account.ok) assert.equal(account.value.purchases[0].amount.amount, '1400');
});

test('retail-only successor retains existing official debt without financial reapproval', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  fixture.source.view.owner = { ...fixture.source.view.owner, revision: 2, integrityHash: 'sha256-v1:' + 'b'.repeat(64) };
  fixture.purchases = [{ source: fixture.source, official: { invoice, receivable: fixture.receivables[0],
    received: { amount: '0', currency: 'IRR' }, balance: { amount: '1600', currency: 'IRR' }, status: 'OPEN' } }];
  const account = await adapter.readOwnAccount(fixture.source.partnerSellerId);
  assert.equal(account.ok, true);
  if (account.ok) {
    assert.equal(account.value.purchases[0].owner.revision, 2);
    assert.equal(account.value.purchases[0].balance.amount, '1600');
  }
  assert.equal(fixture.receivables.length, 1);
});

test('official check bounce and reversal balances are shown without erasing receipt history', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  const row = { source: fixture.source, official: { invoice, receivable: fixture.receivables[0],
    received: { amount: '400', currency: 'IRR' as const }, balance: { amount: '1200', currency: 'IRR' as const }, status: 'PARTIALLY_PAID' as const } };
  fixture.purchases = [row];
  const before = structuredClone(fixture.events);
  assert.equal((await adapter.readOwnAccount(fixture.source.partnerSellerId)).ok, true);
  row.official.received.amount = '0';
  row.official.balance.amount = '1600';
  const reversed = await adapter.readOwnAccount(fixture.source.partnerSellerId);
  assert.equal(reversed.ok, true);
  if (reversed.ok) assert.equal(reversed.value.purchases[0].balance.amount, '1600');
  assert.deepEqual(fixture.events, before);
});

test('account rejects mismatched invoice contents even when a copied evidence hash looks valid', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  invoice.preparation.debtor.partnerSellerId = 'another-partner';
  fixture.purchases = [{ source: fixture.source, official: { invoice, receivable: fixture.receivables[0],
    received: { amount: '0', currency: 'IRR' }, balance: { amount: '1600', currency: 'IRR' }, status: 'OPEN' } }];
  assert.equal((await adapter.readOwnAccount(fixture.source.partnerSellerId)).ok, false);
});

test('financial work rejects an internal source linked to a different original commitment', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  fixture.commitment.internalRecordId = 'unrelated-internal-record';
  assert.equal((await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId)).ok, false);
  assert.equal(fixture.receivables.length, 0);
});

test('the actual approved invoice amount must match the frozen internal payable', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  invoice.amount.amount = '2000';
  assert.equal((await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId)).ok, false);
  assert.equal(fixture.receivables.length, 0);
});

test('an internal installment note edit cannot invalidate an approved account or preparation', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const before = await adapter.prepareFinancialRecord(fixture.source.view.owner);
  const invoice = await fixture.invoice();
  await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  fixture.source.view.sabalanPaymentPlan.installments[0].notes = 'یادداشت داخلی تازه حسابداری';
  fixture.purchases = [{ source: fixture.source, official: { invoice, receivable: fixture.receivables[0],
    received: { amount: '0', currency: 'IRR' }, balance: { amount: '1600', currency: 'IRR' }, status: 'OPEN' } }];
  assert.deepEqual(await adapter.prepareFinancialRecord(fixture.source.view.owner), before);
  assert.equal((await adapter.readOwnAccount(fixture.source.partnerSellerId)).ok, true);
});

test('approval replay after a retail-only successor returns original evidence without another receivable', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  const approved = await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId);
  const original = structuredClone({ receivables: fixture.receivables, events: fixture.events });
  fixture.source.view.owner = { ...fixture.source.view.owner, revision: 2, integrityHash: 'sha256-v1:' + 'b'.repeat(64) };
  assert.deepEqual(await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId), approved);
  assert.deepEqual({ receivables: fixture.receivables, events: fixture.events }, original);
});

test('foreign invoice identifiers have the same safe result as missing invoices', async () => {
  const fixture = new PartnerAccountingFixture();
  const adapter = createPartnerAccountingAdapter(fixture);
  const invoice = await fixture.invoice();
  invoice.preparation.owner = { ...invoice.preparation.owner, caseId: 'another-case' };
  assert.deepEqual(await adapter.acceptFinancialApproval(fixture.source.view.owner, invoice.invoiceRecordId),
    await adapter.acceptFinancialApproval(fixture.source.view.owner, 'missing-invoice'));
  assert.equal(fixture.receivables.length, 0);
});
