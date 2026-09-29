import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { partnerCasePageActions, PartnerCaseDetailContent } from '../cases/PartnerCaseDetail';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';

test('pending Partner actions preserve their availability policy and block every duplicate command', () => {
  const available = { canContinue: true, canPreview: true, canIssue: true, canFinalize: true,
    canSendConfirmation: true, canRequestCorrection: true, canCancel: true, canRequestVoid: true,
    canDownload: true, canPrint: true, decisionActions: [{ label: 'تأیید', disabled: false }, { label: 'رد', disabled: true }] };
  const ready = partnerCasePageActions(available);
  const pending = partnerCasePageActions({ ...available, pending: true });
  assert.deepEqual(pending.map(action => action.label), ready.map(action => action.label));
  assert(pending.every(action => action.disabled));
  assert(ready.find(action => action.label === 'رد')?.disabled);
  assert.equal(ready.find(action => action.label === 'تأیید')?.disabled, false);
  assert(ready.some(action => action.label === 'ارسال پیامک تأیید'));
  const html = renderToStaticMarkup(<PartnerCaseDetailContent view={createPartnerFixtures().partner} actions={{ ...available, pending: true }} />);
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(match => match[1]);
  // Navigation remains usable; mutation and PDF buttons are blocked.
  assert(buttons.filter(button => button.includes('disabled')).length >= 5);
});

test('Partner command feedback shares Sales permission, stale-state and connectivity classification', () => {
  const permission = partnerSalesActionFeedback({ response: { status: 403, data: {} } }, 'ثبت تغییرات');
  assert.equal(permission.kind, 'permission');
  const conflict = partnerSalesActionFeedback({ response: { status: 409, data: {} } }, 'ثبت تغییرات');
  assert.equal(conflict.kind, 'stale');
  const network = partnerSalesActionFeedback({ code: 'ERR_NETWORK', request: {} }, 'ارسال پیامک تأیید');
  assert.equal(network.kind, 'error');
  assert.match(network.message, /اطلاعات حفظ شده/);
  assert.doesNotMatch(network.message, /ERR_NETWORK|undefined|\[object/);
});
