import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerContractWizard, partnerCaseNeedsAutomaticPricingInquiry, partnerWizardStepsForDraft, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission } from '../../contract-creation/partner/partnerCaseSubmission';
import { defaultPartnerRetailRows } from '../../contract-creation/partner/partnerRetail';
import { PartnerCreationBoundary, PartnerCreationChannelProvider } from '../../contract-creation/partner/PartnerCreationChannel';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import { createPartnerInquirySubmission, type PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';
import { preservePartnerDeliveriesAcrossProductEdit, rebasePartnerWizardSnapshot,
  shouldPreferLocalPartnerWizard } from '../../contract-creation/partner/partnerWizardEntry';
import { WIZARD_STEPS } from '../../contract-creation/constants/contract.constants';

const fixture = createPartnerFixtures();
const rows = defaultPartnerRetailRows([{ productRowId: fixture.configurationDraft.productRowId, quantity: '2', unit: 'm', inquiryRow: fixture.inquiry.rows[0] }]);
rows[0].wholesaleUnitPrice = { amount: '800', currency: 'IRR' };
const draft: PartnerWizardDraft = { step: 'products', rows, intent: {
  ...fixture.draftSubmissionReference, contractDate: '2026-08-27',
  rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
  customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: fixture.partner.deliveries,
  retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false,
} };
const submission = () => createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
  commands: { execute: async () => { throw new Error('not used'); } },
  recovery: { pending: () => null, savePending: async () => undefined, clearPending: async () => undefined,
    finalizeCommitted: async () => undefined, prepareEditLease: async () => ({ recoveryId: fixture.draftSubmissionReference.recoveryId,
      browserSessionId: 'browser-1', leaseToken: 'lease-1', baseRevision: 0 }) },
});

test('local recovery freshness follows the shared server revision instead of either machine clock', () => {
  assert.equal(shouldPreferLocalPartnerWizard(7, 7), true);
  assert.equal(shouldPreferLocalPartnerWizard(6, 7), false);
  assert.equal(shouldPreferLocalPartnerWizard(undefined, 7), false);
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

test('Partner always keeps the exact ordinary Sales wizard sequence', () => {
  assert.deepEqual(partnerWizardStepsForDraft({ ...draft, intent: { ...draft.intent, deliveries: [] } })
    .map(step => step.id), ['date', 'customer', 'project', 'products', 'delivery', 'payment', 'confirmation']);
  assert.deepEqual(partnerWizardStepsForDraft(draft).map(step => step.label), WIZARD_STEPS.map(step => step.title));
  assert.equal(partnerWizardStepsForDraft(draft).some(step => step.id === 'delivery'), true);
});

test('a numbered unpriced Partner draft automatically enters the Sabalan pricing queue', () => {
  const view = { ...fixture.case, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' };
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry(view, 1), true);
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry({ ...view, pricingState: 'READY_TO_FINALIZE' }, 1), false);
  assert.equal(partnerCaseNeedsAutomaticPricingInquiry(view, 0), false);
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
    recovery={{ state: 'writable' }} submission={submission()} now={Date.parse(fixture.approval.expiresAt)}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /بسته قیمت این پرونده منقضی شده است/);
  assert.match(html, /استعلام مجدد/);
  assert.match(html, /value="800"/);
});

test('a changed technical row keeps the wizard inputs and permits an unpriced numbered save', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'confirmation' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission()} now={Date.parse('2026-08-27T09:00:00.000Z')}
    mismatchedRowIds={[fixture.inquiry.rows[0].rowId]} renderSection={() => <p>preserved-review</p>}
    validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /preserved-review/);
  assert.match(html, /ذخیره قرارداد/);
  assert.match(html, /استعلام مجدد/);
});

test('reloading an uncertain inquiry exposes a reachable retry without a new submission', async () => {
  let pending: PartnerInquirySubmitCommand | null = null;
  const recovery = { pending: () => pending, savePending: async (command: PartnerInquirySubmitCommand) => { pending = command; }, clearPending: async () => undefined };
  const commands = { execute: async () => { throw new Error('lost response'); } };
  const original = createPartnerInquirySubmission({ actorId: fixture.profile.partnerSellerId, inquiryId: fixture.inquiry.inquiryId, commands, recovery });
  await original.submit([{ rowId: 'reload-row', configuration: fixture.configurationDraft }]);
  const html = renderToStaticMarkup(<PartnerInquiryWorkspace actorId={fixture.profile.partnerSellerId} inquiryId={fixture.inquiry.inquiryId}
    queries={{ query: async () => { throw new Error('not used during SSR'); } }} commands={commands} recovery={recovery} writable
    configuredRows={[]} configurationEditor={<p>preserved-configuration</p>} onEnterWizard={async () => undefined} onOpenInquiry={() => undefined}
    onCreateNewInquiry={() => undefined}
    prepareSuccessor={async () => { throw new Error('not used'); }} />);
  assert.match(html, /بررسی نتیجه ارسال/);
  assert.match(html, /preserved-configuration/);
  assert.match(html, /استعلام جدید/);
});
