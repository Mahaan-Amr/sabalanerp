import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerContractWizard, type PartnerWizardDraft } from '../../contract-creation/partner/PartnerContractWizard';
import { createPartnerCaseSubmission } from '../../contract-creation/partner/partnerCaseSubmission';
import { defaultPartnerRetailRows } from '../../contract-creation/partner/partnerRetail';
import { PartnerCreationBoundary, PartnerCreationChannelProvider } from '../../contract-creation/partner/PartnerCreationChannel';
import { PartnerInquiryWorkspace } from '../inquiries/PartnerInquiryWorkspace';
import { createPartnerInquirySubmission, type PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';

const fixture = createPartnerFixtures();
const rows = defaultPartnerRetailRows([{ productRowId: fixture.configurationDraft.productRowId, quantity: '2', unit: 'm', inquiryRow: fixture.inquiry.rows[0] }]);
const draft: PartnerWizardDraft = { step: 'retail', rows, intent: {
  ...fixture.draftSubmissionReference, contractDate: '2026-08-27',
  rows: rows.map(row => ({ productRowId: row.productRowId, approvedRowBinding: row.inquiryRow.approvedRowBinding!, retailUnitPrice: row.retailUnitPrice })),
  customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: fixture.partner.deliveries,
  retailDiscount: { amount: '0', currency: 'IRR' }, belowCostConfirmed: false,
} };
const submission = () => createPartnerCaseSubmission({ actorId: fixture.profile.partnerSellerId,
  commands: { execute: async () => { throw new Error('not used'); } },
  recovery: { pending: () => null, savePending: async () => undefined, clearPending: async () => undefined, finalizeCommitted: async () => undefined },
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
  assert.match(html, /ورودی‌های پرونده حفظ شده‌اند/);
  assert.match(html, /استعلام مجدد/);
  assert.match(html, /value="800"/);
});

test('a changed technical row keeps the wizard inputs but blocks final submission', () => {
  const html = renderToStaticMarkup(<PartnerContractWizard draft={{ ...draft, step: 'review' }} onChange={() => undefined}
    recovery={{ state: 'writable' }} submission={submission()} now={Date.parse('2026-08-27T09:00:00.000Z')}
    mismatchedRowIds={[fixture.inquiry.rows[0].rowId]} renderSection={() => <p>preserved-review</p>}
    validateStep={() => null} onReinquire={() => undefined} onOpenCase={() => undefined} />);
  assert.match(html, /preserved-review/);
  assert.match(html, /disabled=""[^>]*><span>ثبت پرونده/);
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
    prepareSuccessor={async () => { throw new Error('not used'); }} />);
  assert.match(html, /بررسی نتیجه ارسال/);
  assert.match(html, /preserved-configuration/);
});
