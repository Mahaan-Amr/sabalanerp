import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSuccessfulSalesResponse, getSalesErrorSummary, getSalesOperationalErrorKind, getSalesOperationalErrorMessage, mapProductCreationValidationErrors, mapProductEditValidationErrors, normalizeSalesBlobError } from './salesOperationalError';
import { createLatestRequestTracker, hasAnyPendingOperation } from './latestRequestTracker';

test('related seller mutations share one pending guard', () => {
  const pending = new Set(['seller-change']);
  assert.equal(hasAnyPendingOperation(pending, ['seller-change', 'legacy-credit']), true);
  pending.delete('seller-change');
  assert.equal(hasAnyPendingOperation(pending, ['seller-change', 'legacy-credit']), false);
});

test('a late response cannot replace the result of a newer request for the same source', async () => {
  const tracker = createLatestRequestTracker();
  const accepted: string[] = [];
  let finishOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => { finishOld = resolve; });

  const oldSequence = tracker.begin('products');
  const oldCompletion = oldResponse.then(() => {
    if (tracker.isLatest('products', oldSequence)) accepted.push('old');
  });
  const newSequence = tracker.begin('products');
  if (tracker.isLatest('products', newSequence)) accepted.push('new');
  finishOld();
  await oldCompletion;

  assert.deepEqual(accepted, ['new']);
});

test('unexpected sales failure preserves input and exposes a safe tracking reference without deflecting to support', () => {
  const message = getSalesOperationalErrorMessage({
    response: {
      status: 500,
      data: {
        error: 'ثبت قرارداد انجام نشد؛ لطفاً با پشتیبانی تماس بگیرید. کد پیگیری: TRACE-42',
        trackingId: 'TRACE-42',
      },
    },
  }, {
    failedAction: 'ثبت قرارداد',
    nextStep: 'دوباره تلاش کنید.',
    preserveInput: true,
  });

  assert.equal(
    message,
    'ثبت قرارداد انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد. اطلاعات واردشده حفظ شده است. دوباره تلاش کنید. کد پیگیری: TRACE-42',
  );
  assert.doesNotMatch(message, /پشتیبانی|تماس بگیرید/);
});

test('known Persian business cause stays visible beside its exact recovery action', () => {
  const message = getSalesOperationalErrorMessage({
    response: {
      status: 422,
      data: { error: 'جمع پرداخت‌ها ۵ میلیون تومان کمتر از مبلغ قرارداد است.' },
    },
  }, {
    failedAction: 'ثبت برنامه پرداخت',
    nextStep: 'مبلغ پرداخت‌ها را ۵ میلیون تومان افزایش دهید.',
  });

  assert.equal(
    message,
    'جمع پرداخت‌ها ۵ میلیون تومان کمتر از مبلغ قرارداد است. مبلغ پرداخت‌ها را ۵ میلیون تومان افزایش دهید.',
  );
});

test('technical English payload is replaced with a Persian operation-specific recovery message', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 500, data: { error: 'Internal Server Error' } },
  }, {
    failedAction: 'به‌روزرسانی محصول',
    nextStep: 'اطلاعات محصول را بررسی کنید و دوباره تلاش کنید.',
  });

  assert.equal(message, 'به‌روزرسانی محصول انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد. اطلاعات محصول را بررسی کنید و دوباره تلاش کنید.');
});

test('safe 5xx response keeps its user-correctable cause', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 503, data: { error: 'سرویس تولید PDF موقتاً آماده نیست.' } },
  }, {
    failedAction: 'ساخت PDF قرارداد',
    nextStep: 'چند دقیقه دیگر دوباره روی «ساخت PDF» بزنید.',
  });

  assert.equal(message, 'سرویس تولید PDF موقتاً آماده نیست. چند دقیقه دیگر دوباره روی «ساخت PDF» بزنید.');
});

test('safe 5xx mutation cause does not bypass reconciliation before retry', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 500, data: { error: 'پاسخ نهایی ثبت قرارداد دریافت نشد؛ وضعیت قرارداد نامشخص است.' } },
  }, {
    failedAction: 'ثبت قرارداد',
    nextStep: 'دوباره تلاش کنید.',
    uncertainMutation: true,
  });

  assert.match(message, /^پاسخ نهایی ثبت قرارداد دریافت نشد/);
  assert.match(message, /وضعیت فعلی را بررسی کنید؛ فقط اگر عملیات انجام نشده بود دوباره تلاش کنید/);
});

test('resolved failure envelopes cannot continue through a success path', () => {
  const response = { data: { success: false, error: 'اطلاعات نامعتبر است؛ مقادیر مشخص‌شده را اصلاح کنید.' } };
  assert.throws(() => assertSuccessfulSalesResponse(response), (failure: any) => failure.response === response);
  assert.doesNotThrow(() => assertSuccessfulSalesResponse({ data: { success: true, data: { id: 'ok' } } }));
});

test('connection failure names the cause and gives a safe retry step', () => {
  const message = getSalesOperationalErrorMessage({
    code: 'ERR_NETWORK',
    config: { headers: { 'x-correlation-id': 'REQUEST-42' } },
  }, {
    failedAction: 'دریافت فهرست قراردادها',
    nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.',
  });

  assert.equal(message, 'دریافت فهرست قراردادها انجام نشد چون ارتباط با سامانه برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید. کد پیگیری: REQUEST-42');
});

test('response-less unknown failure does not invent a connectivity cause or an untraceable reference', () => {
  const message = getSalesOperationalErrorMessage(new Error('boom'), {
    failedAction: 'ثبت قرارداد',
    nextStep: 'دوباره تلاش کنید.',
    preserveInput: true,
  });

  assert.equal(message, 'ثبت قرارداد انجام نشد چون نتیجه قابل‌اعتمادی دریافت نشد. اطلاعات واردشده حفظ شده است. دوباره تلاش کنید.');
  assert.doesNotMatch(message, /ارتباط|boom|کد پیگیری/);
});

test('mixed Persian and technical payload never reaches the user', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 422, data: { error: 'ثبت نشد چون Prisma P2002 constraint روی customerId رخ داد' } },
  }, {
    failedAction: 'ثبت قرارداد',
    nextStep: 'اطلاعات مشخص‌شده را بررسی کنید و دوباره تلاش کنید.',
  });

  assert.match(message, /^ثبت قرارداد انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد\./);
  assert.doesNotMatch(message, /Prisma|P2002|constraint|customerId/);
});

test('product validation response points to the editable wizard field instead of a generic modal', () => {
  assert.deepEqual(mapProductCreationValidationErrors([
    { path: 'widthValue', msg: 'عرض برش باید عدد باشد؛ عرض را دوباره وارد کنید.' },
    { path: 'motherLengthValue', msg: 'طول مادر باید بیشتر از صفر باشد؛ طول را اصلاح کنید.' },
  ]), {
    cutWidth: 'عرض برش باید عدد باشد؛ عرض را دوباره وارد کنید.',
    motherLengthValue: 'طول مادر باید بیشتر از صفر باشد؛ طول را اصلاح کنید.',
  });
});

test('multiple field errors provide a short summary that directs the user to the first field', () => {
  assert.equal(
    getSalesErrorSummary({ customer: 'مشتری را انتخاب کنید.', amount: 'مبلغ را وارد کنید.' }),
    '۲ مورد نیاز به اصلاح است؛ از اولین فیلد مشخص‌شده شروع کنید.',
  );
  assert.equal(getSalesErrorSummary({ customer: 'مشتری را انتخاب کنید.' }), '');
});

test('unknown mutation failure requires reconciliation before retry', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 500, data: { trackingId: 'REQUEST-77' } },
  }, {
    failedAction: 'حذف محصول',
    nextStep: 'دوباره تلاش کنید.',
    uncertainMutation: true,
  });
  assert.equal(message, 'حذف محصول انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد. وضعیت فعلی را بررسی کنید؛ فقط اگر عملیات انجام نشده بود دوباره تلاش کنید. کد پیگیری: REQUEST-77');
});

test('contract creation can use its more specific reconciliation step', () => {
  const message = getSalesOperationalErrorMessage({ response: { status: 500, data: {} } }, {
    failedAction: 'ثبت قرارداد',
    nextStep: 'ابتدا فهرست قراردادها را بررسی کنید؛ فقط اگر قرارداد ثبت نشده بود دوباره تلاش کنید.',
    preserveInput: true,
    uncertainMutation: true,
  });
  assert.match(message, /ابتدا فهرست قراردادها را بررسی کنید؛ فقط اگر قرارداد ثبت نشده بود/);
});

test('permission and stale responses keep their non-error presentation semantics', () => {
  assert.equal(getSalesOperationalErrorKind({ response: { status: 403 } }), 'permission');
  assert.equal(getSalesOperationalErrorKind({ response: { status: 409 } }), 'stale');
  assert.equal(getSalesOperationalErrorKind({ response: { status: 500 } }), 'error');
});

test('blob download failures preserve a safe business cause and tracking reference', async () => {
  const normalized = await normalizeSalesBlobError({
    response: {
      status: 422,
      data: new Blob([JSON.stringify({
        error: 'قالب اکسل برای این کاتالوگ آماده نیست؛ دوباره تلاش کنید.',
        trackingId: 'EXCEL-42',
      })], { type: 'application/json' }),
    },
  });

  assert.equal(getSalesOperationalErrorMessage(normalized, {
    failedAction: 'دانلود قالب اکسل',
    nextStep: 'دوباره روی «دانلود قالب» بزنید.',
  }), 'قالب اکسل برای این کاتالوگ آماده نیست؛ دوباره تلاش کنید. دوباره روی «دانلود قالب» بزنید. کد پیگیری: EXCEL-42');
});

test('technical blob download payload is not exposed to the user', async () => {
  const normalized = await normalizeSalesBlobError({
    response: { status: 500, data: new Blob(['Prisma P2002 constraint']) },
  });

  const message = getSalesOperationalErrorMessage(normalized, {
    failedAction: 'دریافت خروجی اکسل',
    nextStep: 'دوباره روی «دریافت خروجی» بزنید.',
  });
  assert.equal(message, 'دریافت خروجی اکسل انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد. دوباره روی «دریافت خروجی» بزنید.');
  assert.doesNotMatch(message, /Prisma|P2002|constraint/);
});

test('product edit validation maps only safe messages to editable fields', () => {
  assert.deepEqual(mapProductEditValidationErrors([
    { path: 'basePrice', msg: 'قیمت پایه باید صفر یا بیشتر باشد؛ قیمت را اصلاح کنید.' },
    { path: 'customerId', msg: 'Prisma customerId failed' },
  ]), { basePrice: 'قیمت پایه باید صفر یا بیشتر باشد؛ قیمت را اصلاح کنید.' });
});
