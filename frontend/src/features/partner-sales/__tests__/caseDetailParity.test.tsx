import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCaseDetailContent, partnerCasePageActions } from '../cases/PartnerCaseDetail';

test('Partner contract detail exposes applicable contract actions and delivery allocations', () => {
  const actions = { canPreview: true, canContinue: true, canIssue: true,
    canFinalize: true, canSendConfirmation: true, canRequestCorrection: true,
    canCancel: false, canRequestVoid: false };
  const labels = partnerCasePageActions(actions).map(action => action.label);
  assert.ok(labels.includes('تأیید و نهایی‌سازی قرارداد'));
  assert.ok(labels.includes('ارسال پیامک تأیید'));
  const { partner: view, customer } = createPartnerFixtures();
  const html = renderToStaticMarkup(<PartnerCaseDetailContent view={view} actions={actions}
    customerOutput={customer} history={[{ sequence: 1, type: 'CASE_CREATED', recordedAt: '2026-01-01T00:00:00.000Z' }]} />);
  assert.match(html, /اطلاعات قرارداد/);
  assert.match(html, /اقلام قرارداد/);
  assert.match(html, /تحویل و پرداخت/);
  assert.match(html, /مشتری و پروژه/);
  assert.match(html, /تاریخچه پرونده/);
  assert.match(html, /ایجاد پرونده/);
});
