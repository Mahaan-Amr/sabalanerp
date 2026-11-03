import assert from 'node:assert/strict';
import { nextEvaluationOccurrenceNumber, normalizeCompanyEvaluationPlanItem, validateCompanyEvaluationResult } from '../hrCompanyEvaluationPolicy';

assert.equal(nextEvaluationOccurrenceNumber([1, 3, 4]), 5, 'cancelled or missing occurrences are never reused');
assert.deepEqual(normalizeCompanyEvaluationPlanItem({ type: 'OTHER', subject: 'بررسی ویژه', instructions: 'پیگیری شود', evidencePolicy: 'FILE_OPTIONAL', evaluatorPersonnelId: 'personnel-1' }), {
  type: 'OTHER', subject: 'بررسی ویژه', instructions: 'پیگیری شود', evidencePolicy: 'FILE_OPTIONAL',
  evaluatorPersonnelId: 'personnel-1', externalProviderName: null, externalProviderType: null,
  externalProviderPhone: null, externalProviderNote: null, scorePolicy: 'OPTIONAL', plannedAt: null, reportDueAt: null,
});
assert.throws(() => normalizeCompanyEvaluationPlanItem({ type: 'OTHER', evidencePolicy: 'NO_FILE' }), /subject/i);
assert.throws(() => normalizeCompanyEvaluationPlanItem({ type: 'MANAGEMENT_INTERVIEW', evidencePolicy: 'NO_FILE' }), /Personnel/i);
assert.deepEqual(normalizeCompanyEvaluationPlanItem({
  type: 'THERAPIST_CONSULTATION', evidencePolicy: 'FILE_OPTIONAL', externalProviderName: 'مرکز مشاوره سبلان',
  externalProviderPhone: '۰۹1۲-۳۴۵-۶۷۸۹', plannedAt: '2026-08-25', reportDueAt: '2026-08-26',
}, new Date('2026-08-24T00:00:00.000Z')), {
  type: 'THERAPIST_CONSULTATION', subject: null, instructions: null, evidencePolicy: 'FILE_OPTIONAL',
  evaluatorPersonnelId: null, externalProviderName: 'مرکز مشاوره سبلان', externalProviderType: null,
  externalProviderPhone: '09123456789', externalProviderNote: null, scorePolicy: 'OPTIONAL',
  plannedAt: new Date('2026-08-25T00:00:00.000Z'), reportDueAt: new Date('2026-08-26T00:00:00.000Z'),
});
assert.throws(() => normalizeCompanyEvaluationPlanItem({
  type: 'THERAPIST_CONSULTATION', evidencePolicy: 'NO_FILE', externalProviderName: 'مرکز', externalProviderPhone: '۱۲abc',
}), /phone/i);
assert.throws(() => normalizeCompanyEvaluationPlanItem({
  type: 'THERAPIST_CONSULTATION', evidencePolicy: 'NO_FILE', externalProviderName: 'مرکز',
  plannedAt: '2026-08-25', reportDueAt: '2026-08-24',
}, new Date('2026-08-24T00:00:00.000Z')), /deadline/i);
assert.doesNotThrow(() => validateCompanyEvaluationResult({ evidencePolicy: 'EXPLANATION_REQUIRED', effect: 'NEGATIVE', explanation: 'نتیجه منفی مستند', hasFile: false }));
assert.throws(() => validateCompanyEvaluationResult({ evidencePolicy: 'FILE_REQUIRED', effect: 'POSITIVE', explanation: '', hasFile: false }), /file/i);
assert.doesNotThrow(() => validateCompanyEvaluationResult({ evidencePolicy: 'FILE_OPTIONAL', effect: 'NEGATIVE', explanation: '', hasFile: false }), 'negative evaluation does not reject the applicant or require a reason');
assert.doesNotThrow(() => validateCompanyEvaluationResult({ evidencePolicy: 'NO_FILE', scorePolicy: 'REQUIRED', score: '۵', effect: 'POSITIVE', hasFile: false }));
assert.throws(() => validateCompanyEvaluationResult({ evidencePolicy: 'NO_FILE', scorePolicy: 'REQUIRED', score: '', effect: 'POSITIVE', hasFile: false }), /score/i);
assert.throws(() => validateCompanyEvaluationResult({ evidencePolicy: 'NO_FILE', scorePolicy: 'OPTIONAL', score: '2.5', effect: 'NEUTRAL', hasFile: false }), /score/i);

console.log('HR company evaluation policy tests passed.');
