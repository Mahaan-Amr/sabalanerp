import assert from 'node:assert/strict';
import test from 'node:test';
import { getSalesOperationalErrorMessage, mapProductCreationValidationErrors } from './salesOperationalError';

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

  assert.equal(
    message,
    'به‌روزرسانی محصول انجام نشد. اطلاعات محصول را بررسی کنید و دوباره تلاش کنید.',
  );
});

test('connection failure names the cause and gives a safe retry step', () => {
  const message = getSalesOperationalErrorMessage({}, {
    failedAction: 'دریافت فهرست قراردادها',
    nextStep: 'اتصال را بررسی کنید و دوباره تلاش کنید.',
  });

  assert.equal(
    message,
    'دریافت فهرست قراردادها انجام نشد چون ارتباط با سامانه برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید.',
  );
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
