import assert from 'node:assert/strict';
import {
  classifyContractEditRecoveryFailure,
  getContractEditRecoveryMessage,
  isGenuineContractRevisionConflict
} from '../../utils/contractEditRecoveryConflictPolicy';

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'edit-session-owned-elsewhere',
    phase: 'acquire'
  }),
  { reason: 'owned-elsewhere', applyRecovery: true }
);

assert.equal(isGenuineContractRevisionConflict({
  code: 'revision-conflict',
  currentBaseRevision: 5,
  expectedBaseRevision: 4
}), true, 'a changed canonical base revision must block the stale editor');
assert.equal(isGenuineContractRevisionConflict({
  code: 'revision-conflict',
  currentBaseRevision: 4,
  expectedBaseRevision: 4
}), false, 'same-base checkpoint contention must not show a stale-version banner');
assert.equal(isGenuineContractRevisionConflict({
  code: 'revision-conflict',
  expectedBaseRevision: 4
}), false, 'an unproven revision change must not be presented as a canonical revision change');

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'revision-conflict',
    phase: 'acquire',
    currentBaseRevision: 5,
    expectedBaseRevision: 4
  }),
  { reason: 'revision-conflict', applyRecovery: false }
);

assert.deepEqual(
  classifyContractEditRecoveryFailure({
    status: 409,
    code: 'revision-conflict',
    phase: 'acquire',
    currentBaseRevision: 4,
    expectedBaseRevision: 4
  }),
  { reason: 'recovery-conflict', applyRecovery: false },
  'same-base safety conflicts must not claim that the canonical contract changed'
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
  getContractEditRecoveryMessage('recovery-conflict'),
  'همگام‌سازی امن پیش‌نویس با سرور ممکن نشد؛ برای جلوگیری از بازنویسی، ادامه متوقف شد'
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
