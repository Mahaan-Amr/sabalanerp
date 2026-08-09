import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CaseReview } from './AccountingDispatchDocuments';
import { createFixtureDispatchDocumentsClient } from './dispatchDocumentsFixture';

const noop = () => undefined;

test('issued case exposes two retained downloads and exactly three primary print actions', async () => {
  const workspace = await createFixtureDispatchDocumentsClient('MANAGE').load();
  const item = workspace.cases.find((candidate) => candidate.id === 'dispatch-issued')!;
  const html = renderToStaticMarkup(<CaseReview item={item} workspace={workspace} stale={false} pending={false} rejectionReason="" onRejectionReason={noop} onAccept={noop} onReject={noop} onHandoff={noop} onMore={noop} />);
  assert.match(html, /دانلود بارنامه/);
  assert.match(html, /دانلود صورت‌حساب/);
  assert.equal((html.match(/چاپ بارنامه/g) || []).length, 1);
  assert.equal((html.match(/چاپ صورت‌حساب/g) || []).length, 1);
  assert.equal((html.match(/چاپ هر دو/g) || []).length, 2); // action plus retained-bytes guidance
  assert.match(html, /اصلاحیه‌های افزایشی/);
});

test('view-only case has permitted documents but no mutation control', async () => {
  const workspace = await createFixtureDispatchDocumentsClient('VIEW').load();
  const item = workspace.cases.find((candidate) => candidate.id === 'dispatch-issued')!;
  const html = renderToStaticMarkup(<CaseReview item={item} workspace={workspace} stale={false} pending={false} rejectionReason="" onRejectionReason={noop} onAccept={noop} onReject={noop} onHandoff={noop} onMore={noop} />);
  assert.match(html, /دانلود بارنامه/);
  assert.doesNotMatch(html, /جایگزینی بسته اسناد/);
  assert.doesNotMatch(html, /پذیرش و صدور/);
});

test('blocked case names evidence and owning recovery path without an Accounting bypass', async () => {
  const workspace = await createFixtureDispatchDocumentsClient('MANAGE').load();
  const item = workspace.cases.find((candidate) => candidate.id === 'dispatch-blocked')!;
  const html = renderToStaticMarkup(<CaseReview item={item} workspace={workspace} stale={false} pending={false} rejectionReason="" onRejectionReason={noop} onAccept={noop} onReject={noop} onHandoff={noop} onMore={noop} />);
  assert.match(html, /ردیف پایدار ۱۱/);
  assert.match(html, /بازگشت به لجستیک/);
  assert.doesNotMatch(html, /پذیرش و صدور/);
});
