import assert from 'node:assert/strict';
import {
  buildDeterministicPolicyPreview,
  canonicalPerformanceHash,
  validateCriterionPolicyContent,
  validateLevelPolicyContent,
  validatePerformancePublication,
} from '../personnelPerformancePolicy';
import { validatePerformanceVaultEnvironment } from '../personnelPerformancePayloadStore';

assert.throws(() => validatePerformanceVaultEnvironment({
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'production-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(16).toString('base64'),
}), /exact 32-byte/);
assert.equal(validatePerformanceVaultEnvironment({
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'production-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
}).key.length, 32);

const criterion = {
  schemaVersion: 1 as const,
  conceptCode: 'PERF-QLT-014',
  titleFa: 'کیفیت اجرای مسئولیت',
  meaningFa: 'کیفیت پایدار خروجی را در متن مأموریت می‌سنجد.',
  kind: 'JUDGMENT' as const,
  anchorsFa: [
    'به‌طور جدی پایین‌تر از انتظار',
    'پایین‌تر از انتظار',
    'مطابق انتظار',
    'بالاتر از انتظار',
    'به‌طور استثنایی بالاتر از انتظار',
  ],
  applicability: { fact: 'jobId', operator: 'IN' as const, values: ['job-1'] },
  evidence: {
    allowedKinds: ['OPERATIONAL_REFERENCE' as const],
    minimumReliableCount: 1,
    lookbackDays: 30,
    required: true,
  },
};

assert.deepEqual(validateCriterionPolicyContent(criterion), []);
assert.ok(validateCriterionPolicyContent({
  ...criterion,
  applicability: { fact: 'personnelId', operator: 'IN', values: ['person-1'] },
}).some((message) => message.includes('واقعیت کنترل‌شده')));
assert.ok(validateCriterionPolicyContent({ ...criterion, anchorsFa: criterion.anchorsFa.slice(0, 4) })
  .some((message) => message.includes('پنج درجه')));

const levels = {
  schemaVersion: 1 as const,
  thresholds: [
    { code: 'URGENT_IMPROVEMENT', titleFa: 'نیازمند بهبود فوری', meaningFa: 'معنای یک', minimum: '0.000000', maximumExclusive: '20.000000' },
    { code: 'IMPROVEMENT', titleFa: 'نیازمند بهبود', meaningFa: 'معنای دو', minimum: '20.000000', maximumExclusive: '40.000000' },
    { code: 'MEETS', titleFa: 'مطابق انتظار', meaningFa: 'معنای سه', minimum: '40.000000', maximumExclusive: '60.000000' },
    { code: 'EXCEEDS', titleFa: 'فراتر از انتظار', meaningFa: 'معنای چهار', minimum: '60.000000', maximumExclusive: '80.000000' },
    { code: 'OUTSTANDING', titleFa: 'عملکرد برجسته', meaningFa: 'معنای پنج', minimum: '80.000000', maximumInclusive: '100.000000' },
  ],
};
assert.deepEqual(validateLevelPolicyContent(levels), []);
assert.ok(validateLevelPolicyContent({
  ...levels,
  thresholds: levels.thresholds.map((threshold, index) => index === 1
    ? { ...threshold, minimum: '20.000001' }
    : threshold),
}).some((message) => message.includes('شکاف')));

assert.deepEqual(validatePerformancePublication({
  now: new Date('2026-08-31T08:00:00.000Z'),
  effectiveFrom: new Date('2026-08-31T20:30:00.000Z'),
  reason: 'اجرای نسخه مصوب برای دوره‌های آینده',
}), []);
assert.ok(validatePerformancePublication({
  now: new Date('2026-08-31T08:00:00.000Z'),
  effectiveFrom: new Date('2026-08-31T08:30:00.000Z'),
  reason: 'اجرای گذشته‌نگر',
}).some((message) => message.includes('ابتدای روز آینده تهران')));

const preview = buildDeterministicPolicyPreview([
  { subjectId: 'subject-b', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'LEVEL', levelCode: 'EXCEEDS' } },
  { subjectId: 'subject-a', before: { state: 'LEVEL', levelCode: 'EXCEEDS' }, after: { state: 'LEVEL', levelCode: 'MEETS' } },
  { subjectId: 'subject-c', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'LEVEL', levelCode: 'MEETS' } },
  { subjectId: 'subject-d', before: { state: 'LEVEL', levelCode: 'MEETS' }, after: { state: 'NEEDS_NEW_EVALUATION', levelCode: null } },
]);
assert.deepEqual(preview.counts, {
  eligible: 4,
  evaluated: 4,
  increased: 1,
  decreased: 1,
  unchanged: 1,
  expired: 0,
  needsNewEvaluation: 1,
  errors: 0,
});
assert.deepEqual(preview.population.map(({ subjectId }) => subjectId), ['subject-a', 'subject-b', 'subject-c', 'subject-d']);
assert.equal(preview.resultHash, canonicalPerformanceHash(preview.population));

console.log('Personnel performance policy tests passed.');
