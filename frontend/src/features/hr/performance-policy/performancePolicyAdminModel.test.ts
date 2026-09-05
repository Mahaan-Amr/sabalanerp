import assert from 'node:assert/strict';
import {
  criterionDraftValidation,
  defaultCriterionDraft,
  lifecyclePresentation,
  policyKindLabel,
  summarizePreview,
} from './performancePolicyAdminModel';

assert.deepEqual(lifecyclePresentation('SCHEDULED'), { label: 'زمان‌بندی‌شده', tone: 'info' });
assert.equal(policyKindLabel('CURRENT_LEVEL'), 'تجمیع سطح جاری');
assert.deepEqual(criterionDraftValidation(defaultCriterionDraft()), [
  'عنوان فارسی معیار را وارد کنید.',
  'معنای کسب‌وکاری معیار را وارد کنید.',
  'برای هر پنج درجه توضیح رفتاری اختصاصی بنویسید.',
]);
assert.deepEqual(summarizePreview({
  eligible: 10, evaluated: 10, increased: 2, decreased: 1, unchanged: 5,
  expired: 1, needsNewEvaluation: 1, errors: 0,
}), [
  { label: 'افزایش سطح', value: 2, tone: 'success' },
  { label: 'کاهش سطح', value: 1, tone: 'warning' },
  { label: 'بدون تغییر', value: 5, tone: 'neutral' },
  { label: 'انقضا', value: 1, tone: 'danger' },
  { label: 'نیازمند ارزیابی جدید', value: 1, tone: 'info' },
  { label: 'خطا', value: 0, tone: 'neutral' },
]);

console.log('Performance policy administration model tests passed.');
