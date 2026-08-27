import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerInquiryPanel } from '../inquiries/PartnerInquiryPanel';
import { createPartnerInquiryReader } from '../inquiries/partnerInquiryReader';
import type { PartnerQueryV2Port } from '@sabalanerp/partner-sales-contracts';
import { enterPartnerWizard } from '../../contract-creation/partner/partnerWizardEntry';
import { createPartnerInquirySubmission, type PartnerInquirySubmitCommand } from '../inquiries/partnerInquirySubmission';

test('partial inquiry shows each outcome and only one Dock progression for usable approvals', () => {
  const { inquiry } = createPartnerFixtures();
  inquiry.rows.push({ rowId: 'pending', revision: 1, description: 'اسلب در انتظار', state: 'PENDING', configuration: [], usedCaseNumbers: [], configurationRef: { ...inquiry.rows[0].configurationRef, productRowId: 'pending-product' } });
  inquiry.rows.push({ rowId: 'rejected', revision: 1, description: 'پله ردشده', state: 'REJECTED', configuration: [], usedCaseNumbers: [], noteOrReason: 'این سنگ موجود نیست', configurationRef: { ...inquiry.rows[0].configurationRef, productRowId: 'rejected-product' } });
  const html = renderToStaticMarkup(<PartnerInquiryPanel
    inquiry={inquiry} now={Date.parse('2026-08-27T09:00:00.000Z')}
    pending={false} onRefresh={() => undefined} onReinquire={() => undefined}
    onEnterWizard={() => undefined}
  />);
  assert.match(html, /پاسخ جزئی/);
  assert.match(html, /این سنگ موجود نیست/);
  assert.equal((html.match(/ساخت پرونده و ورود به Wizard/g) || []).length, 1);
  assert.match(html, /۱ ردیف آماده/);
  assert.match(html, /استعلام مجدد/);
  assert.doesNotMatch(html, /materialRate|calculationPolicy|fixture-313-rate/);
});

test('exact product-row references own entry; quantity and delivery changes do not invalidate approval', () => {
  const fixture = createPartnerFixtures();
  const base = { ...fixture.draftSubmissionReference, customerId: '', contractDate: '2026-08-27',
    customerPaymentPlan: fixture.partner.customerPaymentPlan, deliveries: [], retailDiscount: { amount: '0', currency: 'IRR' as const } };
  const input = { inquiry: fixture.inquiry, now: Date.parse('2026-08-27T09:00:00.000Z'), base,
    quantities: [{ productRowId: fixture.configurationDraft.productRowId, quantity: '250', unit: 'm' }] };
  const draft = enterPartnerWizard(input);
  assert.equal(draft?.rows[0].quantity, '250');
  assert.equal(draft?.intent.rows[0].retailUnitPrice.amount, '800');
  assert.equal(enterPartnerWizard({ ...input, quantities: [{ productRowId: fixture.inquiry.rows[0].rowId, quantity: '250', unit: 'm' }] }), null);
  assert.equal(enterPartnerWizard({ ...input, mismatchedRowIds: [fixture.inquiry.rows[0].rowId] }), null);
  assert.equal(enterPartnerWizard({ ...input, now: Date.parse(fixture.approval.expiresAt) }), null);
});

test('a pending successor remains visible while its valid predecessor is still usable', () => {
  const { inquiry } = createPartnerFixtures();
  inquiry.rows[0].successor = { inquiryId: 'next-inquiry', rowId: 'next-row', revision: 1, state: 'PENDING' };
  const html = renderToStaticMarkup(<PartnerInquiryPanel inquiry={inquiry} now={Date.parse('2026-08-27T09:00:00.000Z')}
    pending={false} onRefresh={() => undefined} onReinquire={() => undefined} onEnterWizard={() => undefined} onOpenInquiry={() => undefined} />);
  assert.match(html, /۱ ردیف آماده/);
  assert.match(html, /استعلام بعدی: در انتظار پاسخ/);
  assert.match(html, /مشاهده استعلام بعدی/);
});

test('bulk inquiry retry replays safe recovery references and the original successor reason', async () => {
  const fixture = createPartnerFixtures();
  let pending: PartnerInquirySubmitCommand | null = null;
  const sent: PartnerInquirySubmitCommand[] = [];
  const submit = createPartnerInquirySubmission({ actorId: fixture.profile.partnerSellerId, inquiryId: fixture.inquiry.inquiryId,
    commands: { execute: async command => {
      assert.equal(command.type, 'INQUIRY_SUBMIT'); sent.push(command as PartnerInquirySubmitCommand);
      if (sent.length === 1) throw new Error('offline');
      return { ok: true, value: { commandId: command.commandId, replayed: true, eventIds: [] } };
    } },
    recovery: { pending: () => pending, savePending: async command => { pending = command; }, clearPending: async () => { pending = null; } },
  });
  await submit.submit([{ rowId: 'successor-row', configuration: fixture.configurationDraft,
    predecessor: { rowId: fixture.inquiry.rows[0].rowId, revision: 1, reason: 'تغییر مشخصات سنگ' } }]);
  assert.equal(submit.getSnapshot().phase, 'uncertain');
  await submit.retry();
  assert.deepEqual(sent[1], sent[0]);
  assert.doesNotMatch(JSON.stringify(sent), /materialRate|formula|basePrice/);
  assert.equal(submit.getSnapshot().phase, 'submitted');
});

test('expiry at the exact boundary removes an approval from the Dock without removing its evidence', () => {
  const { inquiry } = createPartnerFixtures();
  const html = renderToStaticMarkup(<PartnerInquiryPanel inquiry={inquiry}
    now={Date.parse(inquiry.rows[0].expiresAt!)} pending={false}
    onRefresh={() => undefined} onReinquire={() => undefined} onEnterWizard={() => undefined} />);
  assert.match(html, /۰ ردیف آماده/);
  assert.match(html, /پایان اعتبار/);
  assert.match(html, /۸۰۰ ریال/);
  assert.match(html, /disabled=""[^>]*><span>ساخت پرونده و ورود به Wizard/);
});

test('a late earlier refresh cannot replace the latest partial response', async () => {
  const { inquiry } = createPartnerFixtures();
  const pending = structuredClone(inquiry);
  pending.rows[0].state = 'PENDING';
  const responses: Array<(value: unknown) => void> = [];
  const queries = { query: () => new Promise<unknown>(resolve => responses.push(resolve)) } as PartnerQueryV2Port;
  const reader = createPartnerInquiryReader(queries, inquiry.inquiryId);
  const older = reader.refresh();
  const newer = reader.refresh();
  responses[1]({ ok: true, value: inquiry });
  await newer;
  responses[0]({ ok: true, value: pending });
  await older;
  assert.equal(reader.getSnapshot().inquiry?.rows[0].state, 'APPROVED');
});

test('recovered inquiry command cannot be replayed into a different inquiry scope', async () => {
  const fixture = createPartnerFixtures();
  let pending: PartnerInquirySubmitCommand | null = null;
  const recovery = { pending: () => pending, savePending: async (command: PartnerInquirySubmitCommand) => { pending = command; }, clearPending: async () => undefined };
  const first = createPartnerInquirySubmission({ actorId: fixture.profile.partnerSellerId, inquiryId: fixture.inquiry.inquiryId, recovery,
    commands: { execute: async () => { throw new Error('offline'); } } });
  await first.submit([{ rowId: 'row', configuration: fixture.configurationDraft }]);
  let sent = false;
  const different = createPartnerInquirySubmission({ actorId: fixture.profile.partnerSellerId, inquiryId: 'different-inquiry', recovery,
    commands: { execute: async () => { sent = true; throw new Error('unexpected replay'); } } });
  await different.retry();
  assert.equal(sent, false);
  assert.ok(pending);
});
