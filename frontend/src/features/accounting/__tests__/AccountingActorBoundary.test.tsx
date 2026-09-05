import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingActorBoundary } from '../AccountingActorBoundary';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('Accounting hides private rows and open actions until the current actor is resolved', () => {
  for (const state of [{ actorId: 'prior-accountant', loading: true }, { actorId: null, loading: false }]) {
    const html = renderToStaticMarkup(<AccountingActorBoundary {...state}>
      <div>private-wholesale-1600<button>private-receipt-action</button></div>
    </AccountingActorBoundary>);
    assert.doesNotMatch(html, /private-wholesale|private-receipt-action/);
    assert.match(html, /در حال بررسی دسترسی حسابداری|ورود به حساب/);
  }
});

test('resolved actor can render the authorized Accounting view', () => {
  const html = renderToStaticMarkup(<AccountingActorBoundary actorId="current-accountant" loading={false}>
    <div>authorized-view</div>
  </AccountingActorBoundary>);
  assert.match(html, /authorized-view/);
});
