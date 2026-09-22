import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerContractWizard, partnerCaseNeedsAutomaticPricingInquiry, partnerWizardStepsForDraft,
  requiredPartnerWizardStep, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission } from '../../contract-creation/partner/partnerCaseSubmission';
import { alignPartnerCustomerPaymentPlan, defaultPartnerRetailRows, partnerRetailIntentRows,
  partnerRetailSummary } from '../../contract-creation/partner/partnerRetail';
import { PartnerCreationBoundary, PartnerCreationChannelProvider } from '../../contract-creation/partner/PartnerCreationChannel';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import { createPartnerInquirySubmission, type PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';
import { preservePartnerDeliveriesAcrossProductEdit, rebasePartnerWizardSnapshot,
  partnerCasePendingStorageKey, partnerCreationPathAfterCustomerCreate, shouldPreferLocalPartnerWizard,
  isExplicitPartnerCreationEntry, partnerProductEditPath, shouldOfferPartnerDraftChoice,
  shouldStartFreshPartnerCreation } from '../../contract-creation/partner/partnerWizardEntry';
import { WIZARD_STEPS } from '../../contract-creation/constants/contract.constants';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { selectPartnerReinquiryRows } from '../../contract-creation/partner/partnerReinquiry';

const fixture = createPartnerFixtures();
const rows = defaultPartnerRetailRows([{ productRowId: fixture.configurationDraft.productRowId, quantity: '2', unit: 'm', inquiryRow: fixture.inquiry.rows[0] }]);
rows[0].wholesaleUnitPrice = { amount: '800', currency: 'IRR' };
const draft: PartnerWizardDraft = { step: 'products', rows, intent: {
  ...fixture.draftSubmissionReference, contractDate: '2026-08-27',
  rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
  customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: fixture.partner.deliveries,
  retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false,
} };
const submission = (initialCase?: PartnerCaseView) => createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
  commands: { execute: async () => { throw new Error('not used'); } },
  initialCase,
  recovery: { pending: () => null, savePending: async () => undefined, clearPending: async () => undefined,
    finalizeCommitted: async () => undefined, prepareEditLease: async () => ({ recoveryId: fixture.draftSubmissionReference.recoveryId,
      browserSessionId: 'browser-1', leaseToken: 'lease-1', baseRevision: 0 }) },
});

test('local recovery freshness follows the shared server revision instead of either machine clock', () => {
  assert.equal(shouldPreferLocalPartnerWizard(7, 7), true);
  assert.equal(shouldPreferLocalPartnerWizard(6, 7), false);
  assert.equal(shouldPreferLocalPartnerWizard(undefined, 7), false);
});

test('opening customer creation starts an isolated Partner attempt instead of restoring another customer products', () => {
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newCustomer=1')), true);
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newInquiry=1')), true);
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams()), false);
});

test('opening new partner contract creation offers a choice even with one unfinished draft', () => {
  assert.equal(shouldOfferPartnerDraftChoice(1, new URLSearchParams(), false), true);
  assert.equal(shouldOfferPartnerDraftChoice(2, new URLSearchParams(), false), true);
  assert.equal(shouldOfferPartnerDraftChoice(1, new URLSearchParams('draftId=draft-1'), false), false);
  assert.equal(shouldOfferPartnerDraftChoice(1, new URLSearchParams('newInquiry=1'), true), false);
});

test('the sidebar new-contract entry is distinct from a resumed wizard and still preserves the draft choice', () => {
  const entry = new URLSearchParams('entry=new-contract');
  assert.equal(isExplicitPartnerCreationEntry(entry), true);
  assert.equal(shouldStartFreshPartnerCreation(entry), false);
  assert.equal(shouldOfferPartnerDraftChoice(1, entry, false), true);
  assert.equal(isExplicitPartnerCreationEntry(new URLSearchParams()), false);
});

test('customer creation pins the fresh recovery and removes the new-customer entry flag', () => {
  const path = partnerCreationPathAfterCustomerCreate('fresh-draft', 'new-customer');
  assert.equal(path, '/dashboard/sales/contracts/create?customerId=new-customer&draftId=fresh-draft');
  assert.equal(new URL(path, 'https://example.test').searchParams.has('newCustomer'), false);
});

test('product correction keeps the numbered case and focuses the rejected product', () => {
  const path = partnerProductEditPath('recovery 1', 'case/1', 'product row 2');
  const url = new URL(path, 'https://example.test');
  assert.equal(url.pathname, '/dashboard/sales/contracts/create');
  assert.equal(url.searchParams.get('configure'), '1');
  assert.equal(url.searchParams.get('draftId'), 'recovery 1');
  assert.equal(url.searchParams.get('caseId'), 'case/1');
  assert.equal(url.searchParams.get('focusProductRowId'), 'product row 2');
});

test('uncertain Case commands are isolated per recovery instead of leaking into the next customer attempt', () => {
  assert.notEqual(
    partnerCasePendingStorageKey('partner-user', 'recovery-a'),
    partnerCasePendingStorageKey('partner-user', 'recovery-b'),
  );
});

test('an acknowledged earlier save rebases the newer queued local snapshot before its retry', () => {
  const queued = { savedAt: 99, serverRevision: 4, draft: { marker: 'newer-B' } };
  const rebased = rebasePartnerWizardSnapshot(queued, 5);
  assert.deepEqual(rebased, { ...queued, serverRevision: 5 });
  assert.equal(shouldPreferLocalPartnerWizard(rebased.serverRevision, 5), true);
  assert.equal(rebased.draft.marker, 'newer-B');
});

test('product editing preserves split and grouped deliveries while adding only new product defaults', () => {
  const previous = [
    { deliveryId: 'delivery-a', date: '2026-09-01', destination: 'مقصد اول', items: [
      { productRowId: 'row-a', quantity: '1' }, { productRowId: 'row-b', quantity: '2' },
    ] },
    { deliveryId: 'delivery-b', date: '2026-09-02', destination: 'مقصد دوم', items: [
      { productRowId: 'row-a', quantity: '3' }, { productRowId: 'removed-row', quantity: '1' },
    ] },
  ];
  const defaults = [
    { deliveryId: 'default-a', date: '2026-09-10', destination: 'پیش‌فرض', items: [{ productRowId: 'row-a', quantity: '4' }] },
    { deliveryId: 'default-c', date: '2026-09-11', destination: 'پیش‌فرض جدید', items: [{ productRowId: 'row-c', quantity: '5' }] },
  ];
  assert.deepEqual(preservePartnerDeliveriesAcrossProductEdit(previous, defaults, ['row-a', 'row-b', 'row-c']), [
    { ...previous[0] },
    { ...previous[1], items: [{ productRowId: 'row-a', quantity: '3' }] },
    defaults[1],
  ]);
});

test('Partner inserts Case-scoped pricing immediately after the ordinary product step', () => {
  assert.deepEqual(partnerWizardStepsForDraft({ ...draft, intent: { ...draft.intent, deliveries: [] } })
    .map(step => step.id), ['date', 'customer', 'project', 'products', 'pricing', 'delivery', 'payment', 'confirmation']);
  assert.deepEqual(partnerWizardStepsForDraft(draft).filter(step => step.id !== 'pricing').map(step => step.label),
    WIZARD_STEPS.map(step => step.title));
  assert.equal(partnerWizardStepsForDraft(draft).find(step => step.id === 'pricing')?.label, 'استعلام قیمت');
  assert.equal(partnerWizardStepsForDraft(draft).some(step => step.id === 'delivery'), true);
});

test('legacy late-step recovery returns to products before numbering and to pricing after numbering', () => {
  assert.equal(requiredPartnerWizardStep('confirmation', false, false), 'products');
  assert.equal(requiredPartnerWizardStep('confirmation', true, false), 'pricing');
  assert.equal(requiredPartnerWizardStep('confirmation', true, true), 'confirmation');
});

test('numbering at the pricing boundary keeps the provisional customer plan compatible with retail total', () => {
  const unaligned = { ...draft.intent.customerPaymentPlan,
    installments: draft.intent.customerPaymentPlan.installments.map((item, index) => index === 0
      ? { ...item, amount: { ...item.amount, amount: '0' } } : item) };
  const aligned = alignPartnerCustomerPaymentPlan(draft.rows, draft.intent.retailDiscount, unaligned);
  const summary = partnerRetailSummary(draft.rows, draft.intent.retailDiscount);
  assert.equal(summary.valid, true);
  assert.equal(aligned.installments[0]?.amount.amount, summary.valid ? summary.retail : undefined);
});

test('canonical Partner retail preview uses quoted area and ancillary costs instead of linear display quantity', () => {
  const canonicalRows = [{ ...draft.rows[0], quantity: '3.75',
    retailUnitPrice: { amount: '2000000', currency: 'IRT' as const },
    retailEffectiveUnitPrice: { amount: '828000', currency: 'IRT' as const },
    wholesaleUnitPrice: undefined }];
  const summary = partnerRetailSummary(canonicalRows, { amount: '0', currency: 'IRT' });
  assert.equal(summary.valid, true);
  assert.equal(summary.valid ? summary.retail : undefined, '3105000');
  const plan = alignPartnerCustomerPaymentPlan(canonicalRows, { amount: '0', currency: 'IRT' },
    { ...draft.intent.customerPaymentPlan, installments: draft.intent.customerPaymentPlan.installments.map(item => ({
      ...item, amount: { amount: '7500000', currency: 'IRT' as const },
    })) });
  assert.equal(plan.installments[0]?.amount.amount, '3105000');
});

test('the atomic numbered save owns initial Sabalan pricing without a duplicate automatic re-inquiry', () => {
  const view: PartnerCaseView = { ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' };
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry(view, 1), false);
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry({ ...view, pricingState: 'READY_TO_FINALIZE' }, 1), false);
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry(view, 0), false);
});

test('re-inquiry keeps the original case pricing package scope and can target one product', () => {
  const sibling = { ...fixture.inquiry.rows[0], rowId: 'fixture-sibling-row',
    configurationRef: { ...fixture.inquiry.rows[0].configurationRef, productRowId: 'fixture-sibling-product' } };
  const packageRows = selectPartnerReinquiryRows([fixture.inquiry.rows[0], sibling], fixture.inquiry.inquiryId);
  assert.equal(packageRows.inquiryId, fixture.inquiry.inquiryId);
  assert.deepEqual(packageRows.rows.map(row => row.rowId), [fixture.inquiry.rows[0].rowId, sibling.rowId]);
  const single = selectPartnerReinquiryRows([fixture.inquiry.rows[0], sibling], fixture.inquiry.inquiryId, sibling);
  assert.deepEqual(single.rows.map(row => row.rowId), [sibling.rowId]);
});

test('unsubmitted placeholder prices explain automatic pricing instead of claiming package expiry', () => {
  const pendingRows = draft.rows.map(row => ({ ...row, inquiryRow: { ...row.inquiryRow,
    state: 'PENDING' as const, approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined,
    approvedRowBinding: undefined } }));
  const pendingDraft = { ...draft, rows: pendingRows, intent: { ...draft.intent,
    rows: pendingRows.map(row => ({ productRowId: row.productRowId, retailUnitPrice: row.retailUnitPrice })) } };
  const html = renderToStaticMarkup(<PartnerContractWizard draft={pendingDraft} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission()} now={Date.parse('2026-08-27T09:00:00.000Z')}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /با ادامه از این مرحله.*پرونده شماره‌دار.*فروشنده سبلان/);
  assert.doesNotMatch(html, /بسته قیمت این پرونده منقضی شده|استعلام مجدد/);
});

test('a centrally blocked Partner entry never mounts the ordinary Sales wizard', () => {
  const html = renderToStaticMarkup(<PartnerCreationChannelProvider value={{ kind: 'blocked', message: 'ابتدا تأیید قیمت دریافت کنید.' }}>
    <PartnerCreationBoundary><p>ordinary-sales-sentinel</p></PartnerCreationBoundary>
  </PartnerCreationChannelProvider>);
  assert.match(html, /ابتدا تأیید قیمت/);
  assert.doesNotMatch(html, /ordinary-sales-sentinel/);
});

test('an active competing location presents one takeover decision without a separate resume choice', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={draft} onChange={() => undefined}
    recovery={{ state: 'takeover', takeover: async () => undefined, discard: async () => undefined }}
    submission={submission()} now={Date.parse('2026-08-27T09:00:00.000Z')}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /ادامه ویرایش در اینجا/);
  assert.doesNotMatch(html, /ادامه پیش‌نویس<|قیمت فروش به مشتری —/);
});

test('expiry during the wizard retains entered retail data and exposes inline re-inquiry', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={draft} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'EXPIRED' })} now={Date.parse(fixture.approval.expiresAt)}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /بسته قیمت این پرونده منقضی شده است/);
  assert.match(html, /استعلام مجدد/);
  assert.match(html, /value="800"/);
});

test('a changed technical row keeps the wizard inputs and defers its first inquiry to the numbered save', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'products' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission()} now={Date.parse('2026-08-27T09:00:00.000Z')}
    mismatchedRowIds={[fixture.inquiry.rows[0].rowId]} renderSection={() => <p>preserved-review</p>}
    validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /قیمت فروش به مشتری/);
  assert.match(html, /ارسال برای استعلام قیمت/);
  assert.doesNotMatch(html, /استعلام مجدد/);
});

test('the numbered pricing step blocks delivery while Sabalan has not answered every product', () => {
  const pendingRows = draft.rows.map(row => ({ ...row, inquiryRow: { ...row.inquiryRow,
    state: 'PENDING' as const, approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined,
    approvedRowBinding: undefined } }));
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: pendingRows,
    intent: { ...draft.intent, rows: partnerRetailIntentRows(pendingRows) } }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-08-27T09:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /در انتظار پاسخ/);
  assert.match(html, /پس از پاسخ همه ردیف‌ها، ادامه به برنامه تحویل فعال می‌شود/);
  const actionLabel = html.indexOf('در انتظار تکمیل استعلام');
  assert.ok(actionLabel > 0);
  assert.match(html.slice(html.lastIndexOf('<button', actionLabel), actionLabel), /disabled=""/);
});

test('the pricing step reveals each Sabalan offer and exposes explicit partner acceptance', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-08-27T09:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /قیمت پیشنهادی سبلان/);
  assert.match(html, /800 ریال/);
  assert.match(html, /ساخت پرونده/);
  assert.doesNotMatch(html, /در انتظار تکمیل استعلام|ساخت پرونده و ورود به Wizard/);
});

test('reloading an uncertain inquiry exposes a reachable retry without a new submission', async () => {
  let pending: PartnerInquirySubmitCommand | null = null;
  const recovery = { pending: () => pending, savePending: async (command: PartnerInquirySubmitCommand) => { pending = command; }, clearPending: async () => undefined };
  const commands = { execute: async () => { throw new Error('lost response'); } };
  const original = createPartnerInquirySubmission({ actorId: fixture.profile.partnerSellerId, inquiryId: fixture.inquiry.inquiryId, commands, recovery });
  await original.submit([{ rowId: 'reload-row', configuration: fixture.configurationDraft }]);
  const html = renderToStaticMarkup(<PartnerInquiryWorkspace actorId={fixture.profile.partnerSellerId} inquiryId={fixture.inquiry.inquiryId}
    queries={{ query: async () => { throw new Error('not used during SSR'); } }} commands={commands} recovery={recovery} writable
    configuredRows={[]} configurationEditor={<p>preserved-configuration</p>} onOpenInquiry={() => undefined}
    onCreateNewInquiry={() => undefined}
    prepareSuccessor={async () => { throw new Error('not used'); }} />);
  assert.match(html, /بررسی نتیجه ارسال/);
  assert.match(html, /preserved-configuration/);
  assert.match(html, /استعلام جدید/);
});
