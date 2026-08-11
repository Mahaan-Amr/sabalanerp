import assert from 'node:assert/strict';
import { nextEvaluationOccurrenceNumber, normalizeCompanyEvaluationPlanItem, validateCompanyEvaluationResult } from '../hrCompanyEvaluationPolicy';

assert.equal(nextEvaluationOccurrenceNumber([1, 3, 4]), 5, 'cancelled or missing occurrences are never reused');
assert.deepEqual(normalizeCompanyEvaluationPlanItem({ type: 'OTHER', subject: 'بررسی ویژه', instructions: 'پیگیری شود', evidencePolicy: 'FILE_OPTIONAL' }), {
  type: 'OTHER', subject: 'بررسی ویژه', instructions: 'پیگیری شود', evidencePolicy: 'FILE_OPTIONAL',
});
assert.throws(() => normalizeCompanyEvaluationPlanItem({ type: 'OTHER', evidencePolicy: 'NO_FILE' }), /subject/i);
assert.doesNotThrow(() => validateCompanyEvaluationResult({ evidencePolicy: 'EXPLANATION_REQUIRED', effect: 'NEGATIVE', explanation: 'نتیجه منفی مستند', hasFile: false }));
assert.throws(() => validateCompanyEvaluationResult({ evidencePolicy: 'FILE_REQUIRED', effect: 'POSITIVE', explanation: '', hasFile: false }), /file/i);
assert.doesNotThrow(() => validateCompanyEvaluationResult({ evidencePolicy: 'FILE_OPTIONAL', effect: 'NEGATIVE', explanation: '', hasFile: false }), 'negative evaluation does not reject the applicant or require a reason');

console.log('HR company evaluation policy tests passed.');
