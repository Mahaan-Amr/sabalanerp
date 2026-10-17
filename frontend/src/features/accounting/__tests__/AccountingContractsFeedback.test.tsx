import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingContractsFeedback, accountingContractsResponse } from '../AccountingContractsFeedback';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('failed contract reads show an alert and retry instead of claiming there are no contracts', () => {
  const html = renderToStaticMarkup(<AccountingContractsFeedback error="شواهد صورتحساب همکار نیاز به بررسی دارد" onRetry={() => {}} />);
  assert.match(html, /role="alert"/);
  assert.match(html, /شواهد صورتحساب همکار/);
  assert.match(html, /تلاش دوباره/);
  assert.doesNotMatch(html, /قراردادی یافت نشد/);
});

test('only a successful empty response presents the normal empty state', () => {
  assert.deepEqual(accountingContractsResponse({ success: true, data: { items: [], total: 0, page: 1, pageSize: 50 } }).items, []);
  const html = renderToStaticMarkup(<AccountingContractsFeedback error={null} onRetry={() => {}} />);
  assert.match(html, /قراردادی یافت نشد/);
  assert.doesNotMatch(html, /role="alert"/);
});

test('unsuccessful and maintenance HTML responses cannot become empty successes', () => {
  for (const payload of [{ success: false, error: 'خطای دریافت' }, '<html>maintenance</html>', { success: true, data: {} }]) {
    assert.throws(() => accountingContractsResponse(payload));
  }
});
