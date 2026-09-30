import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerContractWizard, partnerCaseNeedsAutomaticPricingInquiry, partnerWizardStepsForDraft,
  requiredPartnerWizardStep, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission, saveCompletedPartnerDraft } from '../../contract-creation/partner/partnerCaseSubmission';
import { remainingPartnerAmount, defaultPartnerRetailRows, partnerRetailIntentRows,
  partnerRetailSummary } from '../../contract-creation/partner/partnerRetail';
import { PartnerCreationBoundary, PartnerCreationChannelProvider } from '../../contract-creation/partner/PartnerCreationChannel';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import { createPartnerInquirySubmission, type PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';
import { enterPartnerWizard, partnerDeliveryPlanIssue, preservePartnerDeliveriesAcrossProductEdit, reconcilePartnerDeliveriesToProducts, rebasePartnerWizardSnapshot,
  partnerCasePendingStorageKey, partnerCreationPathAfterCustomerCreate, shouldPreferLocalPartnerWizard,
  isExplicitPartnerCreationEntry, partnerProductEditPath, shouldOfferPartnerDraftChoice,
  shouldStartFreshPartnerCreation, partnerCreationRouteIdentity, partnerCreationRequestedInquiry, partnerSaleReturnStep,
  partnerCaseResultStep, partnerCaseHasIntegrityError, partnerCaseReviewMessage,
  latestMatchingPartnerInquiryRow, partnerCasePricingInquiryIds, partnerFinalizedContractPath } from '../../contract-creation/partner/partnerWizardEntry';
import { partnerProductEditEntry, partnerSaleEntryIssue } from '../../contract-creation/partner/partnerProductEditEntry';
import { WIZARD_STEPS } from '../../contract-creation/constants/contract.constants';
import { partnerError, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { selectPartnerReinquiryRows } from '../../contract-creation/partner/partnerReinquiry';

const fixture = createPartnerFixtures();

test('successful finalization opens exactly the linked customer contract and rejects a mismatched result', () => {
  const result = { success: true, data: { customerContractId: 'created-contract-1',
    case: { ...fixture.partner, state: 'COMMITTED' } } };
  assert.equal(partnerFinalizedContractPath(result, fixture.partner.owner.caseId),
    '/dashboard/sales/contracts/created-contract-1');
  assert.throws(() => partnerFinalizedContractPath(result, 'another-case'));
  assert.throws(() => partnerFinalizedContractPath({ ...result, success: false }, fixture.partner.owner.caseId));
  assert.throws(() => partnerFinalizedContractPath({ success: true, data: { case: result.data.case } },
    fixture.partner.owner.caseId));
});

test('pricing refresh reads published inquiry identities without inventing IDs from Case revisions', () => {
  const root = 'recovery-1';
  const actual = ['partner-case-pricing:recovery-1:1', 'partner-case-pricing:recovery-1:5',
    'partner-case-pricing:recovery-2:2'];
  assert.deepEqual(partnerCasePricingInquiryIds(root, actual, []), actual.slice(0, 2));
  assert.deepEqual(partnerCasePricingInquiryIds(root, [], [fixture.inquiry.rows[0]]),
    [fixture.inquiry.rows[0].approvedRowBinding!.inquiryId]);
});
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

test('each numbered result duty opens its own Case instead of the seller latest inquiry', () => {
  const first = new URLSearchParams('caseId=case-a');
  const second = new URLSearchParams('caseId=case-b');
  assert.notEqual(partnerCreationRouteIdentity(first, 'sale'), partnerCreationRouteIdentity(second, 'sale'));
  assert.equal(partnerCreationRequestedInquiry(first, 'latest-profile-inquiry'), null);
  assert.equal(partnerCreationRequestedInquiry(second, 'latest-profile-inquiry'), null);
  assert.equal(partnerCreationRequestedInquiry(new URLSearchParams(), 'latest-profile-inquiry'), 'latest-profile-inquiry');
});

test('first product-correction click changes the mounted Partner session to the focused editor', () => {
  const result = new URLSearchParams('caseId=case-a');
  const correction = new URL(partnerProductEditPath('recovery-a', 'case-a', 'row-a'), 'https://example.test').searchParams;
  assert.notEqual(partnerCreationRouteIdentity(result, 'sale'), partnerCreationRouteIdentity(correction, 'sale'));
  assert.notEqual(partnerCreationRouteIdentity(correction, 'sale'), partnerCreationRouteIdentity(
    new URLSearchParams('configure=1&draftId=recovery-a&caseId=case-a&focusProductRowId=row-b'), 'sale'));
});

test('a numbered pricing result opens at pricing even when the saved wizard was on products', () => {
  assert.equal(requiredPartnerWizardStep('products', true, false), 'products');
  assert.equal(partnerCaseResultStep('products', true), 'pricing');
  assert.equal(partnerCaseResultStep('delivery', true), 'pricing');
  assert.equal(partnerCaseResultStep('products', false), 'products');
});

test('background pricing refresh preserves a corrected row until its new inquiry is sent', () => {
  const oldRejected = { ...fixture.inquiry.rows[0], state: 'REJECTED' as const };
  const newRevision = oldRejected.configurationRef.recoveryRevision + 1;
  const unsent = { ...oldRejected, rowId: 'corrected-row-awaiting-inquiry',
    state: 'PENDING' as const, submissionState: 'UNSENT' as const,
    configurationRef: { ...oldRejected.configurationRef, recoveryRevision: newRevision } };
  assert.equal(latestMatchingPartnerInquiryRow([oldRejected], unsent), unsent);
  const submitted = { ...unsent, rowId: 'new-inquiry-row', submissionState: undefined };
  assert.equal(latestMatchingPartnerInquiryRow([oldRejected, submitted], unsent), submitted);
});

test('numbered Case integrity failures identify the Case for support while transport failures remain retryable', () => {
  assert.equal(partnerCaseHasIntegrityError(partnerError('INTEGRITY_CONFLICT')), true);
  assert.equal(partnerCaseHasIntegrityError({ response: { data: { error: partnerError('INTEGRITY_CONFLICT') } } }), true);
  assert.equal(partnerCaseHasIntegrityError(new Error('offline')), false);
  assert.match(partnerCaseReviewMessage('PC-123', 313), /همکار-۰۰۳۱۳/);
  assert.match(partnerCaseReviewMessage('PC-123', 313), /پشتیبانی/);
});

test('recovering a numbered result keeps an expired quote visible instead of changing it to pending', () => {
  const { graphHash: _graphHash, rows: _rows, belowCostConfirmed: _belowCostConfirmed, ...base } = draft.intent;
  const expired = { ...fixture.inquiry.rows[0], state: 'EXPIRED' as const,
    expiresAt: '2026-09-25T08:00:00.000Z' };
  const recovered = enterPartnerWizard({ inquiryRows: [expired], now: Date.parse('2026-09-26T08:00:00.000Z'),
    base, validated: fixture.technicalSaved });
  assert.equal(recovered?.rows[0]?.inquiryRow.state, 'EXPIRED');
  assert.equal(recovered?.rows[0]?.inquiryRow.approvedPrice?.amount, expired.approvedPrice?.amount);
  assert.equal(recovered?.rows[0]?.inquiryRow.expiresAt, expired.expiresAt);
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

test('product editing preserves user deliveries without adding schedules for new products', () => {
  const previous = [
    { deliveryId: 'delivery-a', date: '2026-09-01', destination: 'مقصد اول', items: [
      { productRowId: 'row-a', quantity: '1' }, { productRowId: 'row-b', quantity: '2' },
    ] },
    { deliveryId: 'delivery-b', date: '2026-09-02', destination: 'مقصد دوم', items: [
      { productRowId: 'row-a', quantity: '3' }, { productRowId: 'removed-row', quantity: '1' },
    ] },
  ];
  assert.deepEqual(preservePartnerDeliveriesAcrossProductEdit(previous, ['row-a', 'row-b', 'row-c']), [
    { ...previous[0] },
    { ...previous[1], items: [{ productRowId: 'row-a', quantity: '3' }] },
  ]);
  assert.deepEqual(preservePartnerDeliveriesAcrossProductEdit([], ['row-a', 'row-c']), []);
});

test('a corrected product quantity trims stale delivery allocations before price acceptance', () => {
  const deliveries = [{ deliveryId: 'delivery-a', date: '2026-09-01', destination: 'مقصد',
    items: [{ productRowId: 'stone-row', quantity: '500' }, { productRowId: 'other-row', quantity: '100' }] }];
  assert.deepEqual(reconcilePartnerDeliveriesToProducts(deliveries,
    [{ productRowId: 'stone-row', quantity: '300' }, { productRowId: 'other-row', quantity: '100' }]), [
    { ...deliveries[0], items: [{ productRowId: 'stone-row', quantity: '300' },
      { productRowId: 'other-row', quantity: '100' }] },
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

test('late-step recovery requires numbering but never waits for Sabalan pricing', () => {
  assert.equal(requiredPartnerWizardStep('confirmation', false, false), 'products');
  assert.equal(requiredPartnerWizardStep('confirmation', true, false), 'confirmation');
  assert.equal(requiredPartnerWizardStep('confirmation', true, true), 'confirmation');
});

test('new Partner wizard initialization accepts an empty user payment plan', () => {
  const { graphHash, rows, belowCostConfirmed, ...base } = draft.intent;
  const plan = { ...base.customerPaymentPlan, installments: [] };
  const initialized = enterPartnerWizard({ inquiry: fixture.inquiry, now: Date.parse('2026-08-27T09:00:00Z'),
    validated: fixture.technicalSaved, base: { ...base, customerPaymentPlan: plan } });
  assert.ok(initialized);
  assert.deepEqual(initialized.intent.customerPaymentPlan.installments, []);
});

test('canonical Partner retail preview uses quoted area and ancillary costs instead of linear display quantity', () => {
  const canonicalRows = [{ ...draft.rows[0], quantity: '3.75',
    retailUnitPrice: { amount: '2000000', currency: 'IRT' as const },
    retailEffectiveUnitPrice: { amount: '828000', currency: 'IRT' as const },
    wholesaleUnitPrice: undefined }];
  const summary = partnerRetailSummary(canonicalRows, { amount: '0', currency: 'IRT' });
  assert.equal(summary.valid, true);
  assert.equal(summary.valid ? summary.retail : undefined, '3105000');
  assert.equal(remainingPartnerAmount(summary.valid ? summary.retail : '0', ['7500000']), null);

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
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })} now={Date.parse(fixture.approval.expiresAt)}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /اعتبار قیمت پایان یافته/);
  assert.match(html, /اعتبار تا/);
  assert.match(html, /استعلام مجدد/);
  assert.match(html, /800 ریال/);
  assert.doesNotMatch(html, /استعلام مجدد کل بسته|در انتظار پاسخ/);
  assert.doesNotMatch(html, /قیمت سبلان: در انتظار استعلام/);
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

test('inquiry send stays clickable when the background retail quote has not populated yet', () => {
  const unquoted = draft.rows.map(({ retailEffectiveUnitPrice: _quote, ...row }) => row);
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, rows: unquoted }}
    onChange={() => undefined} recovery={{ state: 'writable' }} submission={submission()}
    now={Date.parse('2026-08-27T09:00:00.000Z')} canonicalRetailReady={false}
    onPreparePricingQuote={async current => current} renderSection={() => null}
    validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  const action = html.slice(0, html.indexOf('ارسال برای استعلام قیمت')).split('<button').at(-1) ?? '';
  assert.doesNotMatch(action, /\bdisabled\b/);
});

test('the numbered pricing step allows delivery while Sabalan has not answered every product', () => {
  const pendingRows = draft.rows.map(row => ({ ...row, inquiryRow: { ...row.inquiryRow,
    state: 'PENDING' as const, approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined,
    approvedRowBinding: undefined } }));
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: pendingRows,
    intent: { ...draft.intent, rows: partnerRetailIntentRows(pendingRows) } }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-08-27T09:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /در انتظار پاسخ/);
  const actionLabel = html.indexOf('مرحله بعدی');
  assert.ok(actionLabel > 0);
  assert.doesNotMatch(html.slice(html.lastIndexOf('<button', actionLabel), actionLabel), /disabled=""/);
});

test('waiting for Sabalan keeps the shared progression action available', () => {
  const pendingRows = draft.rows.map(row => ({ ...row, inquiryRow: { ...row.inquiryRow,
    state: 'PENDING' as const, approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined,
    approvedRowBinding: undefined } }));
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: pendingRows }}
    onChange={() => undefined} recovery={{ state: 'writable' }}
    submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-09-26T08:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  const actionLabel = html.indexOf('مرحله بعدی');
  assert.ok(actionLabel > 0);
  assert.doesNotMatch(html.slice(html.lastIndexOf('<button', actionLabel), actionLabel), /disabled=""/);
});

test('the pricing step reveals each Sabalan offer and exposes explicit partner acceptance', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-08-27T09:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /قیمت پیشنهادی سبلان/);
  assert.match(html, /800 ریال/);
  assert.match(html, /پذیرش قیمت‌ها/);
  assert.doesNotMatch(html, /در انتظار تکمیل استعلام|ساخت پرونده و ورود به Wizard/);
});

test('a rejected row shows the responder reason and both correction and re-inquiry actions', () => {
  const rejected = draft.rows.map(row => ({ ...row, inquiryRow: { ...row.inquiryRow,
    state: 'REJECTED' as const, approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined,
    approvedRowBinding: undefined, noteOrReason: 'ابعاد این محصول نیاز به اصلاح دارد' } }));
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: rejected }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-09-26T08:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onEditProduct={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /ابعاد این محصول نیاز به اصلاح دارد/);
  assert.match(html, /استعلام مجدد همین محصول/);
  assert.match(html, /ویرایش این محصول/);
  assert.doesNotMatch(html, /استعلام مجدد کل بسته|در انتظار پاسخ/);
});

test('a corrected rejected row offers an explicit inquiry for that row before waiting for Sabalan', () => {
  const corrected = draft.rows.map((row, index) => index === 0 ? { ...row, inquiryRow: {
    ...row.inquiryRow, rowId: `${row.productRowId}-awaiting-inquiry`, state: 'PENDING' as const, submissionState: 'UNSENT' as const,
    configurationRef: { ...row.inquiryRow.configurationRef, recoveryRevision: row.inquiryRow.configurationRef.recoveryRevision + 1 },
    approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined, approvedRowBinding: undefined,
  } } : row);
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: corrected }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-09-26T08:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onEditProduct={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /استعلام مجدد همین محصول/);
  assert.match(html, /ویرایش این محصول/);
  assert.match(html, /مرحله بعدی/);
});

test('a pending successor no longer offers a duplicate corrected-row inquiry', () => {
  const corrected = draft.rows.map((row, index) => index === 0 ? { ...row, inquiryRow: {
    ...row.inquiryRow, rowId: `${row.productRowId}-awaiting-inquiry`, state: 'PENDING' as const, submissionState: 'UNSENT' as const,
    successor: { inquiryId: 'pricing-2', rowId: 'replacement-1', revision: 1, state: 'PENDING' as const },
    approvedPrice: undefined, approvedAt: undefined, expiresAt: undefined, approvedRowBinding: undefined,
  } } : row);
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing', rows: corrected }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission({ ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY' })}
    now={Date.parse('2026-09-26T08:00:00.000Z')} renderSection={() => null} validateStep={() => null}
    onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.doesNotMatch(html, /استعلام مجدد همین محصول/);
  assert.match(html, /در انتظار پاسخ/);
});

test('an evidence conflict gives the Partner a simple review action with the numbered Case', async () => {
  const existing = { ...fixture.partner, state: 'DRAFT' as const, trackingNumber: 313 };
  const rejected = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId, initialCase: existing,
    commands: { execute: async () => ({ ok: false, error: partnerError('INTEGRITY_CONFLICT') }) },
    recovery: { pending: () => null, savePending: async () => undefined, clearPending: async () => undefined,
      finalizeCommitted: async () => undefined, prepareEditLease: async () => ({ recoveryId: draft.intent.recoveryId,
        browserSessionId: 'browser-1', leaseToken: 'lease-1', baseRevision: 0 }) },
  });
  await rejected.submit(draft.intent);
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'pricing' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={rejected} now={Date.parse('2026-08-27T09:00:00.000Z')}
    renderSection={() => null} validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /این پرونده نیاز به بررسی دارد/);
  assert.match(html, /همکار-۰۰۳۱۳/);
  assert.doesNotMatch(html, new RegExp(existing.caseNumber));
  assert.doesNotMatch(html, /شواهد پرونده با نسخه فعلی سازگار نیست/);
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


test('returning to product edits restores the same recovery customer, project and date', () => {
  const intent = { ...draft.intent, projectId: 'project-edit' };
  const snapshot = { schemaVersion: 1, wizardRevision: 4, step: 'pricing', intent,
    updatedAt: '2026-09-28T08:00:00.000Z' };
  const expected = { customerId: intent.customerId, projectId: intent.projectId, contractDate: intent.contractDate };
  assert.deepEqual(partnerProductEditEntry(intent.recoveryId, snapshot), expected);
  assert.deepEqual(partnerProductEditEntry(intent.recoveryId, undefined, intent), expected);
  assert.throws(() => partnerProductEditEntry('another-recovery', snapshot));
  assert.equal(partnerSaleEntryIssue(expected), null);
  assert.deepEqual(partnerSaleEntryIssue({ ...expected, projectId: '' }), {
    step: 'project', message: 'پروژه را انتخاب کنید.' });
});


test('delivery scheduling is optional but a user-added plan must remain complete', () => {
  const rows = [{ productRowId: 'row-a', quantity: '5' }];
  assert.equal(partnerDeliveryPlanIssue([], rows), null);
  const delivery = { deliveryId: 'user-delivery', date: '2026-09-30', destination: 'مقصد',
    receiverName: 'گیرنده', projectManagerName: 'مدیر', items: [{ productRowId: 'row-a', quantity: '5' }] };
  assert.equal(partnerDeliveryPlanIssue([delivery], rows), null);
  assert.match(partnerDeliveryPlanIssue([{ ...delivery, items: [] }], rows)!, /کامل کنید/);
  assert.match(partnerDeliveryPlanIssue([{ ...delivery, items: [{ productRowId: 'row-a', quantity: '4' }] }], rows)!, /دقیقاً/);
  assert.equal(partnerDeliveryPlanIssue([], rows), null);
});

test('returning to a specific customer draft never restores the latest unrelated inquiry', () => {
  assert.equal(partnerCreationRequestedInquiry(new URLSearchParams('returnTo=contract&step=2&draftId=current-draft&partnerContract=1'), 'previous-inquiry'), null);
});

test('explicit customer and project return steps take precedence over a saved product step', () => {
  assert.equal(partnerSaleReturnStep(new URLSearchParams('returnTo=contract&step=2')), 'customer');
  assert.equal(partnerSaleReturnStep(new URLSearchParams('returnTo=contract&step=3')), 'project');
  assert.equal(partnerSaleReturnStep(new URLSearchParams()), null);
});

test('a correction to one rejected product retains the matched price and original expiry of the other product', () => {
  const { graphHash: _graph, rows: _rows, belowCostConfirmed: _confirmed, ...base } = draft.intent;
  const nextRevision = fixture.technicalSaved.recoveryRevision + 1;
  const approved = { ...fixture.inquiry.rows[0], configurationRef: {
    ...fixture.inquiry.rows[0].configurationRef, recoveryRevision: nextRevision } };
  const rejected = { ...fixture.inquiry.rows[0], rowId: 'rejected-other-row', state: 'REJECTED' as const,
    approvedPrice: undefined, approvedRowBinding: undefined, noteOrReason: 'اصلاح مشخصات',
    configurationRef: { ...fixture.inquiry.rows[0].configurationRef, productRowId: 'product-row:rejected' } };
  const saved = { ...fixture.technicalSaved, recoveryRevision: nextRevision, rows: [
    { ...fixture.technicalSaved.rows[0], configurationRef: approved.configurationRef },
    { ...fixture.technicalSaved.rows[0], configurationRef: { ...rejected.configurationRef, recoveryRevision: nextRevision } },
  ] };
  const recovered = enterPartnerWizard({ inquiryRows: [rejected, approved],
    now: Date.parse(approved.approvedAt!) + 1000, base: { ...base, recoveryRevision: nextRevision }, validated: saved });
  assert.ok(recovered);
  assert.equal(recovered.rows[0].inquiryRow.state, 'APPROVED');
  assert.deepEqual(recovered.rows[0].inquiryRow.approvedPrice, approved.approvedPrice);
  assert.deepEqual(recovered.rows[0].inquiryRow.approvedRowBinding, approved.approvedRowBinding);
  assert.equal(recovered.rows[0].inquiryRow.expiresAt, approved.expiresAt);
  assert.equal(recovered.rows[1].inquiryRow.state, 'REJECTED');
  assert.equal(recovered.rows[1].inquiryRow.submissionState, 'UNSENT');
});

test('completed draft navigation waits for successful persistence and opens the returned Case identity', async () => {
  for (const succeeds of [true, false]) {
    const opened: string[] = [];
    let persisted = false;
    const controller = createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
      commands: { execute: async command => {
        persisted = succeeds;
        return succeeds ? { ok: true as const, value: { commandId: command.commandId, case: fixture.partner } }
          : { ok: false as const, error: partnerError('FORBIDDEN') };
      } },
      recovery: { pending: () => null, savePending: async () => undefined, clearPending: async () => undefined,
        finalizeCommitted: async () => undefined, prepareEditLease: async () => { throw new Error('unused'); } },
    });
    const result = await saveCompletedPartnerDraft(controller, { ...draft.intent, preparationCompleted: true }, caseId => {
      assert.equal(persisted, true);
      opened.push(caseId);
    });
    assert.equal(result, succeeds);
    assert.deepEqual(opened, succeeds ? [fixture.partner.owner.caseId] : []);
  }
});


test('a route bound to a recovery consumes its new-entry intent on refresh', () => {
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newInquiry=1')), true);
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newInquiry=1&draftId=current-draft')), false);
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newInquiry=1&caseId=current-case')), false);
  assert.equal(shouldStartFreshPartnerCreation(new URLSearchParams('newCustomer=1&draftId=current-draft')), true);
});
