import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpInput } from '@/components/erp';
import { CustomerWorkflowFeedback, CustomerWorkflowProgress, CustomerWorkflowSection } from './CustomerWorkflowUi';

test('customer workflow exposes progress, feedback, and canonical field errors', () => {
  const html = renderToStaticMarkup(
    <>
      <CustomerWorkflowProgress current={2} total={3} label="اطلاعات تماس" />
      <CustomerWorkflowFeedback feedback={{ kind: 'error', title: 'ثبت مشتری انجام نشد' }} />
      <CustomerWorkflowSection title="اطلاعات تماس">
        <ErpInput id="mobile" aria-describedby="mobile-error" />
        <p id="mobile-error">شماره همراه معتبر نیست</p>
      </CustomerWorkflowSection>
    </>
  );

  assert.match(html, /مرحله ۲ از ۳/);
  assert.match(html, /اطلاعات تماس/);
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-describedby="mobile-error"/);
});
