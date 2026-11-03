import assert from 'node:assert/strict';
import {
  allowedReviewOutcomes,
  migrationAttentionFlagLabel,
  migrationPrimaryStateLabel,
  reconciliationFilterHref,
  safeMigrationReturnPath,
} from './hrMigrationReconciliationViewModel';

assert.equal(migrationPrimaryStateLabel('PERSONNEL_CURRENT'), 'پرسنل جاری');
assert.equal(migrationPrimaryStateLabel('UNEXPECTED_API_STATE'), 'خطای طبقه‌بندی');
assert.equal(migrationAttentionFlagLabel('UNEXPECTED_API_FLAG'), 'خطای طبقه‌بندی');
assert.equal(safeMigrationReturnPath('/dashboard/hr/migration?focus=cutover'), '/dashboard/hr/migration?focus=cutover');
assert.equal(safeMigrationReturnPath('/dashboard/users'), '/dashboard/hr/migration');
assert.equal(
  reconciliationFilterHref({ attentionFlag: 'MISSING_PRIMARY_ASSIGNMENT' }, '/dashboard/hr/migration?focus=flags'),
  '/dashboard/hr/migration/reconciliation?attentionFlag=MISSING_PRIMARY_ASSIGNMENT&return=%2Fdashboard%2Fhr%2Fmigration%3Ffocus%3Dflags',
);
assert.deepEqual(allowedReviewOutcomes(['UNRESOLVED_PERSONNEL_LINKAGE']), [
  { value: 'ACCESS_ONLY_USER', label: 'کاربر فقط برای دسترسی است' },
]);
assert.deepEqual(allowedReviewOutcomes(['POSSIBLE_DUPLICATE_IDENTITY']), [
  { value: 'DIFFERENT_PEOPLE', label: 'افراد متفاوت‌اند' },
  { value: 'SHARED_IDENTITY', label: 'هویت مشترک ثبت شده است' },
  { value: 'STILL_AMBIGUOUS', label: 'ابهام همچنان باقی است' },
]);
assert.deepEqual(allowedReviewOutcomes(['ASSESSMENT_PLAN_RECONCILIATION']), []);
assert.deepEqual(allowedReviewOutcomes(['MISSING_PRIMARY_ASSIGNMENT']), []);
assert.deepEqual(allowedReviewOutcomes([], 'NEUTRAL_HISTORY'), [
  { value: 'LEGACY_ONLY_CONFIRMED', label: 'فقط سابقه قدیمی تأیید شد' },
]);

console.log('HR migration reconciliation view-model tests passed.');
