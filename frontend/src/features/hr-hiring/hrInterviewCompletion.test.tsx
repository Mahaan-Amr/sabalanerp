import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HrInterviewCompletionError,
  completeHrInterview,
} from './hrInterviewCompletion';

test('completion never records the decision when the final draft save fails', async () => {
  const localPayload = { answer: 'داده محلی حفظ شود' };
  let completed = false;

  await assert.rejects(() => completeHrInterview({
    payload: localPayload,
    flush: async (payload) => {
      assert.equal(payload, localPayload);
      throw new Error('database unavailable');
    },
    complete: async () => { completed = true; },
  }), /database unavailable/);

  assert.equal(completed, false);
  assert.deepEqual(localPayload, { answer: 'داده محلی حفظ شود' });
});

test('completion error exposes a human retry message and hides database internals', () => {
  const html = renderToStaticMarkup(
    <HrInterviewCompletionError
      error={new Error('Invalid prisma.hrInitialInterviewDraft.create constraint 23514')}
      onRetry={() => undefined}
    />,
  );

  assert.match(html, /ذخیره اطلاعات مصاحبه انجام نشد/);
  assert.match(html, /تلاش مجدد/);
  assert.doesNotMatch(html, /prisma|23514|constraint/i);
  assert.match(html, /role="alert"/);
});
