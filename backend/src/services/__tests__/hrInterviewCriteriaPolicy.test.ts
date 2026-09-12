import assert from 'node:assert/strict';
import {
  DEFAULT_INTERVIEW_CRITERIA,
  PERSONALITY_TEST_SUMMARY_CRITERION,
  normalizeInterviewCriteriaPublication,
} from '../hrInterviewCriteriaPolicy';

assert.equal(DEFAULT_INTERVIEW_CRITERIA.length, 18);
assert.deepEqual(DEFAULT_INTERVIEW_CRITERIA[17], PERSONALITY_TEST_SUMMARY_CRITERION);

const publication = normalizeInterviewCriteriaPublication(DEFAULT_INTERVIEW_CRITERIA);
assert.deepEqual(publication[17], { ...PERSONALITY_TEST_SUMMARY_CRITERION, order: 18 });
assert.throws(() => normalizeInterviewCriteriaPublication([{ stableId: 'x', title: '', answerType: 'TEXT', isActive: true }]), /title/i);
assert.throws(() => normalizeInterviewCriteriaPublication([{ stableId: 'x', title: 'x', answerType: 'UNKNOWN', isActive: true }]), /answer type/i);
assert.throws(() => normalizeInterviewCriteriaPublication([
  { stableId: 'x', title: 'x', answerType: 'TEXT', isActive: true },
  { stableId: 'x', title: 'duplicate', answerType: 'TEXT', isActive: true },
]), /unique/i);
assert.throws(() => normalizeInterviewCriteriaPublication([
  ...DEFAULT_INTERVIEW_CRITERIA.slice(0, 17),
  { ...PERSONALITY_TEST_SUMMARY_CRITERION, isActive: false },
]), /قابل تغییر/);
assert.throws(() => normalizeInterviewCriteriaPublication([
  ...DEFAULT_INTERVIEW_CRITERIA.slice(0, 16),
  PERSONALITY_TEST_SUMMARY_CRITERION,
  DEFAULT_INTERVIEW_CRITERIA[16],
]), /هجدهم/);

console.log('HR interview criteria publication tests passed.');
