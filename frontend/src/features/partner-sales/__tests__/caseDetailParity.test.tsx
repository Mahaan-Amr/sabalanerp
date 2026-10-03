import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCaseDetailContent, partnerCasePageActions } from '../cases/PartnerCaseDetail';
import { partnerSaleReturnStep } from '../../contract-creation/partner/partnerWizardEntry';

test('price response continuation is explicit and returns to pricing', () => {
  assert.equal(partnerSaleReturnStep(new URLSearchParams('returnTo=contract&step=5')), 'pricing');
  const labels = partnerCasePageActions({ canContinue: true, canReviewPricing: true, canEditDraft: true }).map(action => action.label);
  assert.ok(labels.includes('ادامه تکمیل قرارداد'));
  assert.ok(labels.includes('ویرایش'));
});

test('Partner contract detail exposes applicable contract actions and delivery allocations', () => {
  const actions = { canPreview: true, canContinue: true, canIssue: true,
    canFinalize: true, canSendConfirmation: true, canRequestCorrection: true,
    canCancel: false, canRequestVoid: false };
  const labels = partnerCasePageActions(actions).map(action => action.label);
  assert.ok(labels.includes('پذیرش قیمت‌ها و نهایی‌سازی'));
  assert.ok(labels.includes('ارسال پیامک تأیید'));
  const { partner: view, customer } = createPartnerFixtures();
  const html = renderToStaticMarkup(<PartnerCaseDetailContent view={view} actions={actions}
    customerOutput={customer} history={[{ sequence: 1, type: 'CASE_CREATED', recordedAt: '2026-01-01T00:00:00.000Z' }]} />);
  assert.match(html, /اطلاعات قرارداد/);
  assert.match(html, /مشتری و پروژه/);
  assert.match(html, /خلاصه/);
  assert.match(html, /اقلام و تحویل/);
  assert.match(html, /وضعیت مالی/);
  assert.match(html, /سوابق/);
  const items = renderToStaticMarkup(<PartnerCaseDetailContent view={view} actions={actions}
    customerOutput={customer} initialSection="items" />);
  assert.match(items, /اقلام قرارداد/);
  assert.match(items, /برنامه تحویل/);
  assert.doesNotMatch(items, new RegExp(view.products[0].productRowId));
  const history = renderToStaticMarkup(<PartnerCaseDetailContent view={view} actions={actions} initialSection="history"
    history={[{ sequence: 1, type: 'CASE_CREATED', recordedAt: '2026-01-01T00:00:00.000Z' }]} />);
  assert.match(history, /ایجاد پرونده/);
});

test('Partner contract toolbar uses existing actions and keeps the SMS label', () => {
  const called: string[] = [];
  const actions = partnerCasePageActions({ canPreview: false, canIssue: false, canContinue: false,
    canFinalize: false, canCancel: false, canRequestVoid: false, canRequestCorrection: true,
    canSendConfirmation: true, canDownload: true, canPrint: true,
    onRequestCorrection: () => { called.push('edit'); }, onDownload: () => { called.push('pdf'); },
    onPrint: () => { called.push('print'); }, onSendConfirmation: () => { called.push('sms'); } });
  assert.deepEqual(actions.map(item => item.label), ['ویرایش', 'دانلود PDF', 'پرینت', 'ارسال پیامک تأیید']);
  actions.forEach(action => action.onClick?.());
  assert.deepEqual(called, ['edit', 'pdf', 'print', 'sms']);
  assert.equal(partnerCasePageActions({ canPreview: false, canIssue: false, canRequestCorrection: false,
    canCancel: false, canRequestVoid: false }).length, 0);
});

test('customer contract decisions replace Case commit and cancellation actions in the Sales header', () => {
  const actions = { canPreview: false, canIssue: false, canFinalize: true, canCancel: true,
    canRequestCorrection: false, canRequestVoid: false };
  const decisionActions = [{ label: 'امضا', onClick: () => undefined }];
  assert.deepEqual(partnerCasePageActions({ ...actions, decisionActions }).map(action => action.label), ['امضا']);
  assert.deepEqual(partnerCasePageActions({ ...actions, decisionActions: [] }), []);
});

test('draft editing resets approvals before exposing recovery or finalized correction editing', () => {
  const called: string[] = [];
  const capabilities = { canPreview: false, canIssue: false, canCancel: false, canRequestVoid: false,
    canContinue: true, canRequestCorrection: true, canEditDraft: true,
    onEditDraft: () => { called.push('reset-approvals'); },
    onContinue: () => { called.push('resume'); },
    onRequestCorrection: () => { called.push('correction'); } };
  const edits = partnerCasePageActions(capabilities).filter(action => action.label === 'ویرایش');
  assert.equal(edits.length, 1);
  edits[0].onClick?.();
  assert.deepEqual(called, ['reset-approvals']);
  assert.ok(partnerCasePageActions({ ...capabilities, pending: true }).every(action => action.disabled));
  partnerCasePageActions({ ...capabilities, canEditDraft: false })[0].onClick?.();
  assert.deepEqual(called, ['reset-approvals', 'resume']);
});
