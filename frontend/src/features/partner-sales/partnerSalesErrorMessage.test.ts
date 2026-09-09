import assert from 'node:assert/strict';
import test from 'node:test';
import { getPartnerSalesErrorMessage } from './partnerSalesErrorMessage';

test('partner sales integrity errors stay actionable without a support deflection', () => {
  const message = getPartnerSalesErrorMessage({ code: 'INTEGRITY_CONFLICT' });
  assert.equal(message, 'شواهد پرونده با نسخه فعلی هم‌خوان نیست؛ وضعیت پرونده را تازه‌سازی کنید.');
  assert.doesNotMatch(message, /پشتیبانی|تماس بگیرید/);
});

test('partner sales permission and stale states name the next user action', () => {
  assert.match(getPartnerSalesErrorMessage({ code: 'FORBIDDEN' }), /صفحه قبل برگردید/);
  assert.match(getPartnerSalesErrorMessage({ code: 'ROW_STALE' }), /تازه‌سازی کنید/);
});
