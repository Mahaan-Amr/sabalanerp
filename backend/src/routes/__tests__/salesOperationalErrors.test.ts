import assert from 'node:assert/strict';
import test from 'node:test';
import { unexpectedSalesErrorResponse } from '../../utils/salesOperationalError';

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
    error: 'ثبت قرارداد انجام نشد. اطلاعات واردشده حفظ شده است؛ دوباره تلاش کنید. کد پیگیری: trace-42',
    trackingId: 'trace-42',
  });
  assert.doesNotMatch(response.error, /پشتیبانی|تماس بگیرید/);
});
