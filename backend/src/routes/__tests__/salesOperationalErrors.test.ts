import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSalesErrorTracking, salesBusinessErrorMessage, unexpectedSalesErrorResponse } from '../../utils/salesOperationalError';

test('unexpected sales response keeps the technical reference without sending the user to support', () => {
  const response = unexpectedSalesErrorResponse({
    code: 'SALES_CONTRACT_CREATE_UNEXPECTED',
    failedAction: 'ثبت قرارداد',
    trackingId: 'trace-42',
    preserveInput: true,
  });

  assert.deepEqual(response, {
    success: false,
    code: 'SALES_CONTRACT_CREATE_UNEXPECTED',
    error: 'ثبت قرارداد انجام نشد. اطلاعات واردشده حفظ شده است؛ وضعیت فعلی را بررسی کنید و فقط اگر عملیات انجام نشده بود دوباره تلاش کنید. کد پیگیری: trace-42',
    trackingId: 'trace-42',
  });
  assert.doesNotMatch(response.error, /پشتیبانی|تماس بگیرید/);
});

test('every server failure gets a server-recordable correlation id', () => {
  assert.deepEqual(
    ensureSalesErrorTracking({ success: false, error: 'خطا' }, 500, 'REQUEST-9', () => 'SERVER-1'),
    { success: false, error: 'خطا', trackingId: 'REQUEST-9' },
  );
  assert.deepEqual(
    ensureSalesErrorTracking({ success: false, error: 'خطا' }, 500, undefined, () => 'SERVER-1'),
    { success: false, error: 'خطا', trackingId: 'SERVER-1' },
  );
});

test('known service failures become simple Persian causes with a recovery step', () => {
  assert.equal(
    salesBusinessErrorMessage('Contract cannot be approved in current status', 'fallback'),
    'قرارداد در وضعیت فعلی قابل‌تأیید نیست؛ وضعیت قرارداد را بررسی کنید.',
  );
  assert.equal(salesBusinessErrorMessage('Prisma P2002', 'عملیات انجام نشد؛ دوباره تلاش کنید.'), 'عملیات انجام نشد؛ دوباره تلاش کنید.');
  assert.equal(
    salesBusinessErrorMessage('ثبت نشد چون Prisma customerId نامعتبر است', 'اطلاعات را بررسی کنید.'),
    'اطلاعات را بررسی کنید.',
  );
  assert.equal(
    salesBusinessErrorMessage('CRM potential project is already linked to a sales contract', 'fallback'),
    'این پروژه قبلاً به یک قرارداد فروش متصل شده است؛ قرارداد متصل را از صفحه پروژه باز کنید.',
  );
});
