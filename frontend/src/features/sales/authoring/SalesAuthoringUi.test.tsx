import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalesAuthoringFeedback, SalesAuthoringProgress, SalesAuthoringSection } from './SalesAuthoringUi';

test('sales authoring workflow renders status, progress, and a focused section', () => {
  const html = renderToStaticMarkup(
    <>
      <SalesAuthoringProgress current={1} total={4} label="اطلاعات پایه" />
      <SalesAuthoringFeedback feedback={{ kind: 'stale', title: 'تغییرات ذخیره‌نشده دارید' }} />
      <SalesAuthoringSection title="اطلاعات پایه">محتوا</SalesAuthoringSection>
    </>
  );

  assert.match(html, /مرحله ۱ از ۴/);
  assert.match(html, /تغییرات ذخیره‌نشده دارید/);
  assert.match(html, /اطلاعات پایه/);
  assert.match(html, /role="status"/);
});
