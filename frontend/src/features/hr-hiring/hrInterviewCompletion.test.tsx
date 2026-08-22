import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HrInterviewCompletionError,
  completeHrInterview,
  interviewCompletionFailure,
  interviewCompletionFocus,
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

  assert.match(html, /تکمیل مصاحبه انجام نشد/);
  assert.match(html, /تلاش مجدد/);
  assert.doesNotMatch(html, /prisma|23514|constraint/i);
  assert.match(html, /role="alert"/);
});

test('completion exposes only structured operational validation errors', () => {
  const structuredError = {
    response: {
      data: {
        code: 'HR_INTERVIEW_EVIDENCE_INVALID',
        error: 'پاسخ معیار «مسئولیت‌پذیری» کامل نیست. این معیار را بررسی کنید.',
        target: 'criterion',
        criterionId: 'responsibility',
      },
    },
  };

  assert.deepEqual(interviewCompletionFailure(structuredError), {
    message: 'پاسخ معیار «مسئولیت‌پذیری» کامل نیست. این معیار را بررسی کنید.',
    target: 'criterion',
    criterionId: 'responsibility',
  });

  const html = renderToStaticMarkup(
    <HrInterviewCompletionError error={structuredError} onRetry={() => undefined} />,
  );
  assert.match(html, /مسئولیت‌پذیری/);
  assert.doesNotMatch(html, /ذخیره اطلاعات مصاحبه انجام نشد/);
});

test('completion validation identifies the affected editor', () => {
  const criterionError = {
    response: { data: { code: 'HR_INTERVIEW_EVIDENCE_INVALID', error: 'criterion', target: 'criterion', criterionId: 'honesty' } },
  };
  assert.deepEqual(
    interviewCompletionFocus(criterionError, ['appearance', 'honesty'], ['custom-one']),
    { target: 'criterion', index: 1 },
  );

  const customError = {
    response: { data: { code: 'HR_INTERVIEW_EVIDENCE_INVALID', error: 'custom', target: 'custom-criterion', criterionId: 'custom-one' } },
  };
  assert.deepEqual(
    interviewCompletionFocus(customError, ['appearance', 'honesty'], ['custom-one']),
    { target: 'custom-criterion', index: 0 },
  );
});
