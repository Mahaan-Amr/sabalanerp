import assert from 'node:assert/strict';
import {
  compensationVerificationDueAt,
  isCompensationPayrollVerified,
  normalizeCompensationReturnReason,
} from '../hrCompensationWorkflow';

assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: 'VERIFIED' }), true);
assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: 'RETURNED', hrApprovedAt: new Date() }), false);
assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: null, hrApprovedAt: new Date() }), false);
assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: null, financeApprovedAt: new Date() }), false);
assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: null, hrApprovedAt: new Date(), financeApprovedAt: new Date() }), true);
assert.equal(isCompensationPayrollVerified({ payrollReviewStatus: null }), false);

assert.equal(
  compensationVerificationDueAt(new Date('2026-08-20T08:30:00.000Z')).toISOString(),
  '2026-08-24T08:30:00.000Z',
);
assert.equal(
  compensationVerificationDueAt(new Date('2026-08-20T08:30:00.000Z'), new Set(['2026-08-23'])).toISOString(),
  '2026-08-25T08:30:00.000Z',
);

assert.deepEqual(normalizeCompensationReturnReason({
  code: 'POLICY_MISMATCH',
  detail: '  مزایای این ردیف با سیاست جاری حقوق سازگار نیست.  ',
}), {
  code: 'POLICY_MISMATCH',
  detail: 'مزایای این ردیف با سیاست جاری حقوق سازگار نیست.',
});
assert.throws(
  () => normalizeCompensationReturnReason({ code: 'UNKNOWN', detail: 'توضیح معتبر' }),
  /دسته بازگشت/,
);
assert.throws(
  () => normalizeCompensationReturnReason({ code: 'AMOUNT_INCORRECT', detail: 'کم' }),
  /توضیح/,
);

console.log('HR compensation workflow tests passed.');
