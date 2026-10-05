import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useContractEditRecovery } from '../../hooks/useContractEditRecovery';
import { getSalesOperationalErrorMessage } from '../../../sales/salesOperationalError';
import { getContractSubmissionRecovery } from '../../utils/contractSubmissionErrors';

let reportMutationFailure!: (error: unknown) => string | null;
function Editor() {
  const recovery = useContractEditRecovery({ scope: null, enabled: false, onRestore: () => {} });
  reportMutationFailure = recovery.reportMutationFailure;
  return null;
}
renderToString(createElement(Editor));

const message = 'این ردیف محصول دارای سابقه مالی یا عملیاتی است و حذف آن مجاز نیست؛ ردیف را اصلاح کنید یا ابتدا فرایند اصلاح مرتبط را انجام دهید.';
const downstreamFailure = { response: { status: 409, data: {
  success: false, code: 'contract-item-has-downstream-evidence', error: message, message,
  trackingId: 'f13e3d6e-5482-43de-8d03-a1243360eb3d',
} } };
assert.equal(reportMutationFailure(downstreamFailure), null,
  'a protected-row rejection must not revoke edit ownership or replace the business error');
assert.equal(getContractSubmissionRecovery(409, true, downstreamFailure.response.data.code).uncertainMutation, false,
  'the rejected transaction is known to have rolled back; do not imply an uncertain save');
assert.ok(getSalesOperationalErrorMessage(downstreamFailure, {
  failedAction: 'ذخیره تغییرات قرارداد', preserveInput: true,
  nextStep: 'ردیف را بازبینی کنید.',
}).includes(message));
for (const status of [409, 403]) {
  assert.equal(reportMutationFailure({ response: { status, data: { code: 'unrelated-business-error' } } }), null);
  assert.equal(reportMutationFailure({ response: { status, data: { conflict: { code: 'unknown-conflict' } } } }), null);
}
assert.equal(reportMutationFailure({ response: { status: 409, data: {
  conflict: { code: 'edit-session-owned-elsewhere' },
} } }), 'اختیار ویرایش این قرارداد به محل دیگری منتقل شده است');
assert.equal(reportMutationFailure({ response: { status: 409, data: {
  conflict: { code: 'edit-session-missing' },
} } }), 'این قرارداد در محل دیگری در حال ویرایش است');
console.log('contractEditMutationFailure tests passed');
