import assert from 'node:assert/strict';
import { buildDutyQueueTabs, dutyClaimFailureMessage, dutyQueueEmptyTitle } from './dutyQueuePresentation';

assert.deepEqual(
  buildDutyQueueTabs({ open: 2, available: 3, triage: 4, historyUnseen: 5, canManageTriage: false }).map(({ value, count }) => ({ value, count })),
  [
    { value: 'assigned', count: 2 },
    { value: 'available', count: 3 },
    { value: 'history', count: 5 },
  ],
);
assert.deepEqual(
  buildDutyQueueTabs({ open: 2, available: 3, triage: 4, historyUnseen: 5, canManageTriage: true }).map(({ value, label }) => ({ value, label })),
  [
    { value: 'assigned', label: 'وظایف من' },
    { value: 'available', label: 'قابل دریافت' },
    { value: 'triage', label: 'بدون مسئول' },
    { value: 'history', label: 'تاریخچه' },
  ],
);
assert.equal(dutyQueueEmptyTitle('available'), 'وظیفه قابل دریافت وجود ندارد');
assert.equal(
  dutyClaimFailureMessage({ response: { status: 403, data: { error: 'این درخواست را شما ثبت کرده‌اید؛ مدیر حسابداری دیگری باید آن را دریافت کند.' } } }),
  'این درخواست را شما ثبت کرده‌اید؛ مدیر حسابداری دیگری باید آن را دریافت کند.',
);
assert.match(dutyClaimFailureMessage({ response: { status: 500, data: {} } }), /دریافت وظیفه انجام نشد/);
console.log('Cross-workspace duty queue presentation tests passed.');
