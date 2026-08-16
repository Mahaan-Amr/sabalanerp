import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalesAuthoringFeedback, SalesAuthoringProgress, SalesAuthoringSection, hasContractTemplateDraft, hasSalesDraftChanged } from './SalesAuthoringUi';

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

test('sales dirty state tracks actual product and every template authoring branch', () => {
  const product = { basePrice: '100', images: [] };
  assert.equal(hasSalesDraftChanged(product, product), false);
  assert.equal(hasSalesDraftChanged({ ...product, basePrice: '200' }, product), true);
  const template = { name: '', namePersian: '', description: '', content: '', variables: {}, structure: {}, calculations: {} };
  assert.equal(hasContractTemplateDraft(template), false);
  assert.equal(hasContractTemplateDraft({ ...template, structure: { sections: ['header'] } }), true);
  assert.equal(hasContractTemplateDraft({ ...template, calculations: { formulas: { total: 'x' } } }), true);
});
