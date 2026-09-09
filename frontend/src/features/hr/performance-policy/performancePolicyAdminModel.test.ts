import assert from 'node:assert/strict';
import {
  applicabilityOperatorsForFact,
  criterionDraftValidation,
  createTypedApplicabilityRule,
  defaultCriterionDraft,
  lifecyclePresentation,
  policyKindLabel,
  summarizePreview,
  typedApplicabilityValuesFromInput,
} from './performancePolicyAdminModel';

assert.deepEqual(lifecyclePresentation('SCHEDULED'), { label: 'زمان‌بندی‌شده', tone: 'info' });
assert.equal(policyKindLabel('CURRENT_LEVEL'), 'تجمیع سطح جاری');
assert.deepEqual(criterionDraftValidation(defaultCriterionDraft()), [
  'عنوان فارسی معیار را وارد کنید.',
  'معنای کسب‌وکاری معیار را وارد کنید.',
  'برای هر پنج درجه توضیح رفتاری اختصاصی بنویسید.',
]);
assert.deepEqual(createTypedApplicabilityRule('hasSafetyDuty'), {
  schemaVersion: 1, fact: 'hasSafetyDuty', factType: 'BOOLEAN', source: 'VERSIONED_DOCUMENTED_DUTY', sourceVersion: 'PERF_APPLICABILITY_V1', operator: 'EQUALS', values: [true],
});
assert.deepEqual(applicabilityOperatorsForFact('hasSafetyDuty'), ['EQUALS']);
assert.deepEqual(applicabilityOperatorsForFact('jobId'), ['EQUALS', 'IN']);
assert.deepEqual(applicabilityOperatorsForFact('responsibilityCodes'), ['IN', 'EXISTS']);
assert.ok(criterionDraftValidation({
  ...defaultCriterionDraft(),
  titleFa: 'ایمنی',
  meaningFa: 'رعایت ایمنی',
  anchorsFa: ['۱', '۲', '۳', '۴', '۵'],
  applicability: { ...createTypedApplicabilityRule('hasSafetyDuty'), operator: 'EXISTS', values: [] },
}).includes('عملگر انتخاب‌شده برای این واقعیت کاربردپذیری مجاز نیست.'));
assert.deepEqual(typedApplicabilityValuesFromInput('BOOLEAN', 'false'), [false]);
assert.deepEqual(typedApplicabilityValuesFromInput('STRING_LIST', 'PAYABLES, RECEIVABLES'), ['PAYABLES', 'RECEIVABLES']);
assert.deepEqual(typedApplicabilityValuesFromInput('DATE', '2026-01-15'), ['2026-01-15']);
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
