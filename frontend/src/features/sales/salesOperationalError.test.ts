import assert from 'node:assert/strict';
import test from 'node:test';
import { getSalesErrorSummary, getSalesOperationalErrorKind, getSalesOperationalErrorMessage, mapProductCreationValidationErrors, mapProductEditValidationErrors } from './salesOperationalError';

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
    'ثبت قرارداد انجام نشد. اطلاعات واردشده حفظ شده است. دوباره تلاش کنید. کد پیگیری: TRACE-42',
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

  assert.equal(message, 'به‌روزرسانی محصول انجام نشد. اطلاعات محصول را بررسی کنید و دوباره تلاش کنید.');
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

  assert.equal(message, 'ثبت قرارداد انجام نشد. اطلاعات واردشده حفظ شده است. دوباره تلاش کنید.');
  assert.doesNotMatch(message, /ارتباط|boom|کد پیگیری/);
});

test('mixed Persian and technical payload never reaches the user', () => {
  const message = getSalesOperationalErrorMessage({
    response: { status: 422, data: { error: 'ثبت نشد چون Prisma P2002 constraint روی customerId رخ داد' } },
  }, {
    failedAction: 'ثبت قرارداد',
    nextStep: 'اطلاعات مشخص‌شده را بررسی کنید و دوباره تلاش کنید.',
  });

  assert.match(message, /^ثبت قرارداد انجام نشد\./);
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
  assert.equal(message, 'حذف محصول انجام نشد. وضعیت فعلی را بررسی کنید؛ فقط اگر عملیات انجام نشده بود دوباره تلاش کنید. کد پیگیری: REQUEST-77');
});

test('permission and stale responses keep their non-error presentation semantics', () => {
  assert.equal(getSalesOperationalErrorKind({ response: { status: 403 } }), 'permission');
  assert.equal(getSalesOperationalErrorKind({ response: { status: 409 } }), 'stale');
  assert.equal(getSalesOperationalErrorKind({ response: { status: 500 } }), 'error');
});

test('product edit validation maps only safe messages to editable fields', () => {
  assert.deepEqual(mapProductEditValidationErrors([
    { path: 'basePrice', msg: 'قیمت پایه باید صفر یا بیشتر باشد؛ قیمت را اصلاح کنید.' },
    { path: 'customerId', msg: 'Prisma customerId failed' },
  ]), { basePrice: 'قیمت پایه باید صفر یا بیشتر باشد؛ قیمت را اصلاح کنید.' });
});
