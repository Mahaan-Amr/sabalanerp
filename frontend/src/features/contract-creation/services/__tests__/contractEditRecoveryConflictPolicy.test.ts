import assert from 'node:assert/strict';
import {
  classifyContractEditRecoveryFailure,
  getContractEditRecoveryMessage
} from '../../utils/contractEditRecoveryConflictPolicy';

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'edit-session-owned-elsewhere',
    phase: 'acquire'
  }),
  { reason: 'owned-elsewhere', applyRecovery: true }
);

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'revision-conflict',
    phase: 'acquire'
  }),
  { reason: 'revision-conflict', applyRecovery: false }
);

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'edit-session-owned-elsewhere',
    phase: 'takeover'
  }),
  { reason: 'takeover-failed', applyRecovery: false }
);

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 403,
    phase: 'takeover'
  }),
  { reason: 'permission', applyRecovery: false }
);

assert.equal(
  getContractEditRecoveryMessage('revision-conflict'),
  'نسخه قرارداد تغییر کرده است؛ برای دریافت آخرین اطلاعات، قرارداد را دوباره بارگذاری کنید'
);
assert.equal(
  getContractEditRecoveryMessage('ownership-lost'),
  'اختیار ویرایش این قرارداد به محل دیگری منتقل شده است'
);
assert.equal(
  getContractEditRecoveryMessage('takeover-failed'),
  'انتقال اختیار ویرایش انجام نشد؛ دوباره تلاش کنید'
);
assert.equal(
  getContractEditRecoveryMessage('permission'),
  'شما اجازه ویرایش این قرارداد را ندارید'
);

console.log('contractEditRecoveryConflictPolicy tests passed');
