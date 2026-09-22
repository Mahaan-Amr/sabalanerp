import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractCreationDraftPrompt } from './ContractCreationDraftPrompt';

test('ordinary and Partner contract creation share the same unfinished-draft decision', () => {
  const html = renderToStaticMarkup(<ContractCreationDraftPrompt
    onResume={() => undefined}
    onStartNew={() => undefined}
  />);

  assert.match(html, /یک پیش‌نویس ناتمام برای این قرارداد پیدا شد/);
  assert.match(html, /ادامه پیش‌نویس قبلی/);
  assert.match(html, /شروع قرارداد جدید/);
  assert.doesNotMatch(html, /نام پیش‌نویس|ذخیره نام|حذف پیش‌نویس/);
});
