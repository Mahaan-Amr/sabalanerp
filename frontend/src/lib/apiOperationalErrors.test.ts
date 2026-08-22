import assert from 'node:assert/strict';
import { normalizeOperationalErrorPayload } from './api';

assert.deepEqual(
  normalizeOperationalErrorPayload({ success: false, error: 'DUTY_LEGACY_ACCOUNTING_CORRECTION_WRITER_RETIRED' }, 410),
  {
    success: false,
    error: 'این عملیات دیگر از این مسیر انجام نمی‌شود. صفحه را تازه‌سازی کنید و از مسیر پیشنهادی سامانه ادامه دهید.',
    message: 'این عملیات دیگر از این مسیر انجام نمی‌شود. صفحه را تازه‌سازی کنید و از مسیر پیشنهادی سامانه ادامه دهید.',
  },
);

assert.deepEqual(
  normalizeOperationalErrorPayload({ success: false, message: 'فروشنده مسئول قرارداد مشخص نیست.' }, 409),
  { success: false, error: 'فروشنده مسئول قرارداد مشخص نیست.', message: 'فروشنده مسئول قرارداد مشخص نیست.' },
);

assert.equal(normalizeOperationalErrorPayload('plain body', 500), 'plain body');

assert.deepEqual(
  normalizeOperationalErrorPayload({ success: false, error: 'INTERNAL_FAILURE' }, 500, 'REQ-123'),
  {
    success: false,
    error: 'سرویس موقتاً پاسخ‌گو نیست. دوباره تلاش کنید و در صورت تکرار کد پیگیری REQ-123 را به پشتیبانی اعلام کنید.',
    message: 'سرویس موقتاً پاسخ‌گو نیست. دوباره تلاش کنید و در صورت تکرار کد پیگیری REQ-123 را به پشتیبانی اعلام کنید.',
    trackingId: 'REQ-123',
  },
);

console.log('Operational API error normalization tests passed.');
