import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSalesErrorTracking, knownContractUpdateBusinessFailure, knownCustomerCreditFailure, knownProductCatalogApplyError, salesBusinessErrorMessage, unexpectedSalesErrorResponse } from '../../utils/salesOperationalError';
import { CustomerCreditError } from '../../services/specialCustomerCreditPolicy';

test('customer credit validation preserves its actionable cause and status on Sales writes', () => {
  assert.deepEqual(knownCustomerCreditFailure(new CustomerCreditError(400, 'تاریخ وعده پرداخت باید امروز یا آینده باشد.')), {
    status: 400, body: { success: false, code: 'CUSTOMER_CREDIT_VALIDATION', error: 'تاریخ وعده پرداخت باید امروز یا آینده باشد.' },
  });
  assert.equal(knownCustomerCreditFailure(new CustomerCreditError(409, 'اعتبار آزاد کافی نیست.'))?.status, 409);
  assert.equal(knownCustomerCreditFailure(new Error('database unavailable')), undefined);
});

test('approved cancellation denial stays an actionable permission failure on editor save', () => {
  const message = 'این قرارداد تایید شده است و بدون دسترسی ویژه قابل لغو نیست';
  assert.deepEqual(knownContractUpdateBusinessFailure(message), {
    status: 403, body: { success: false, code: 'SALES_CONTRACT_CANCELLATION_DENIED', error: message },
  });
});

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

test('catalog apply exposes only expected correctable failures as client errors', () => {
  assert.equal(
    knownProductCatalogApplyError('پیش‌نمایش منقضی شده است. فایل را دوباره بارگذاری کنید'),
    'پیش‌نمایش منقضی شده است؛ فایل را دوباره بارگذاری کنید.',
  );
  assert.equal(knownProductCatalogApplyError('database unavailable'), undefined);
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

test('customer name mismatch remains actionable instead of becoming a generic response', () => {
  assert.equal(
    salesBusinessErrorMessage(
      'نام مشتری در اطلاعات قرارداد با رکورد اصلی CRM یکسان نیست.',
      'این عملیات فروش انجام نشد؛ اطلاعات را بررسی و دوباره تلاش کنید.'
    ),
    'نام مشتری در پیش‌نویس با اطلاعات ثبت‌شده یکسان نیست؛ مشتری را دوباره از فهرست انتخاب کنید.'
  );
});

test('a signed contract edit requires Accounting correction instead of an unexpected 500', () => {
  assert.deepEqual(knownContractUpdateBusinessFailure(
    'Signed contract commercial evidence can only change through an approved formal correction',
  ), {
    status: 400,
    body: {
      success: false,
      code: 'SALES_CONTRACT_FORMAL_CORRECTION_REQUIRED',
      error: 'این قرارداد امضا یا چاپ شده یا رکورد مالی دارد؛ تغییر آن باید از مسیر اصلاح رسمی تأییدشده انجام شود.',
    },
  });
  assert.equal(knownContractUpdateBusinessFailure(
    'Existing accounting financial record requires an approved formal correction',
  )?.body.code, 'SALES_CONTRACT_FORMAL_CORRECTION_REQUIRED');
  assert.equal(knownContractUpdateBusinessFailure('database unavailable'), null);
});
