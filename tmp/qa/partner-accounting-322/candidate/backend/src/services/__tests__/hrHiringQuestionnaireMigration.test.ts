import assert from 'node:assert/strict';
import {
  classifyLegacyEducation,
  classifyLegacyGraduationYear,
} from '../hrHiringQuestionnaireMigration';

assert.deepEqual(classifyLegacyEducation('کارشناسی ارشد'), {
  kind: 'CHANGE',
  educationLevel: 'MASTER',
  educationLevelOther: '',
  legacyRaw: 'کارشناسی ارشد',
});
assert.deepEqual(classifyLegacyEducation('مهندسی حرفه‌ای'), {
  kind: 'CHANGE',
  educationLevel: 'OTHER',
  educationLevelOther: 'مهندسی حرفه‌ای',
  legacyRaw: 'مهندسی حرفه‌ای',
});
assert.deepEqual(classifyLegacyEducation('BACHELOR'), { kind: 'VALID' });
assert.deepEqual(classifyLegacyGraduationYear('1402', 1405), { kind: 'VALID' });
assert.deepEqual(classifyLegacyGraduationYear('۱۳۹۹', 1405), {
  kind: 'REVIEW',
  reason: 'NON_CANONICAL_YEAR',
  raw: '۱۳۹۹',
});
assert.deepEqual(classifyLegacyGraduationYear('سال ۱۳۹۹', 1405), {
  kind: 'REVIEW',
  reason: 'AMBIGUOUS_YEAR',
  raw: 'سال ۱۳۹۹',
});
assert.deepEqual(classifyLegacyGraduationYear('1299', 1405), {
  kind: 'REVIEW',
  reason: 'YEAR_OUT_OF_RANGE',
  raw: '1299',
});

console.log('HR hiring questionnaire migration policy tests passed.');
