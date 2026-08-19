import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequiredInterviewChoice, ScoreControl } from './HrInterviewPrototype';

test('required interview choice presents an unanswered state without a selectable unset option', () => {
  const html = renderToStaticMarkup(
    <RequiredInterviewChoice
      ariaLabel="اثر در تصمیم"
      value={null}
      onChange={() => undefined}
      options={[
        { value: 'POSITIVE', label: 'مثبت' },
        { value: 'NEUTRAL', label: 'خنثی' },
        { value: 'NEGATIVE', label: 'منفی' },
      ]}
    />,
  );

  assert.match(html, /هنوز انتخاب نشده/);
  assert.doesNotMatch(html, />ثبت نشده</);
  assert.doesNotMatch(html, /پاک‌کردن انتخاب/);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 3);
});

test('required interview choice offers a secondary clear action after selection', () => {
  const html = renderToStaticMarkup(
    <RequiredInterviewChoice
      ariaLabel="نتیجه مستقل مصاحبه‌گر"
      value="POSITIVE"
      onChange={() => undefined}
      options={[
        { value: 'POSITIVE', label: 'مثبت' },
        { value: 'NEGATIVE', label: 'منفی' },
      ]}
    />,
  );

  assert.match(html, /پاک‌کردن انتخاب/);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /هنوز انتخاب نشده/);
});

test('required score distinguishes no answer and supports clearing a real answer', () => {
  const unanswered = renderToStaticMarkup(
    <ScoreControl value={null} onChange={() => undefined} />,
  );
  assert.match(unanswered, /هنوز انتخاب نشده/);
  assert.doesNotMatch(unanswered, /پاک‌کردن انتخاب/);

  const answered = renderToStaticMarkup(
    <ScoreControl value={3} onChange={() => undefined} />,
  );
  assert.match(answered, /پاک‌کردن انتخاب/);
  assert.doesNotMatch(answered, /هنوز انتخاب نشده/);
});
