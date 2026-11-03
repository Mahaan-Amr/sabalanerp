import assert from 'node:assert/strict';
import { normalizeCandidateAssessmentResult } from '../hrCandidateAssessment';

const expectInvalid = (assessmentType: string, result: unknown) => {
  assert.throws(
    () => normalizeCandidateAssessmentResult(assessmentType, result),
    /امتیاز|نتیجه|عنوان|نوع ارزیابی/,
  );
};

expectInvalid('DISC', {});
expectInvalid('DISC', { dominance: 80, influence: 70, steadiness: 60 });
expectInvalid('DISC', { dominance: 101, influence: 70, steadiness: 60, conscientiousness: 50 });
expectInvalid('BIG_FIVE', {});
expectInvalid('EQ', {});
expectInvalid('EQ', { score: -1 });
expectInvalid('EQ', { score: 100.001 });
expectInvalid('EQ', { score: Number.POSITIVE_INFINITY });
expectInvalid('OTHER', { title: '', result: '' });
expectInvalid('UNKNOWN', { score: 50 });

assert.deepEqual(
  normalizeCandidateAssessmentResult('DISC', {
    dominance: 80,
    influence: 70,
    steadiness: 60,
    conscientiousness: 50,
    notes: '  نتیجه آزمایشی  ',
  }),
  {
    dominance: 80,
    influence: 70,
    steadiness: 60,
    conscientiousness: 50,
    notes: 'نتیجه آزمایشی',
  },
);

assert.deepEqual(
  normalizeCandidateAssessmentResult('BIG_FIVE', {
    openness: 90,
    conscientiousness: 80,
    extraversion: 70,
    agreeableness: 60,
    neuroticism: 50,
  }),
  {
    openness: 90,
    conscientiousness: 80,
    extraversion: 70,
    agreeableness: 60,
    neuroticism: 50,
  },
);

assert.deepEqual(normalizeCandidateAssessmentResult('EQ', { score: 75 }), { score: 75 });
assert.deepEqual(normalizeCandidateAssessmentResult('EQ', { score: '۱۰۰' }), { score: 100 });
assert.deepEqual(normalizeCandidateAssessmentResult('EQ', { score: '٧٥٫٢٥' }), { score: 75.25 });
assert.deepEqual(normalizeCandidateAssessmentResult('EQ', { score: '0.01' }), { score: 0.01 });
assert.deepEqual(
  normalizeCandidateAssessmentResult('OTHER', { title: 'آزمون تخصصی', result: 'مناسب' }),
  { title: 'آزمون تخصصی', result: 'مناسب' },
);

console.log('HR candidate assessment validation tests passed.');
