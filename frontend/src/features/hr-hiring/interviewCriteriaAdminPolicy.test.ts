import assert from 'node:assert/strict';
import {
  INTERVIEW_CRITERIA_ANSWER_TYPE_OPTIONS,
  canMoveInterviewCriterion,
  isProtectedPersonalityTestCriterion,
} from './interviewCriteriaAdminPolicy';

const criteria = Array.from({ length: 19 }, (_, index) => ({
  stableId: index === 17 ? 'personalityTestSummary' : `criterion-${index + 1}`,
}));

assert.equal(isProtectedPersonalityTestCriterion(criteria[17]), true);
assert.equal(isProtectedPersonalityTestCriterion(criteria[0]), false);
assert.equal(canMoveInterviewCriterion(criteria, 17, 16), false);
assert.equal(canMoveInterviewCriterion(criteria, 16, 17), false);
assert.equal(canMoveInterviewCriterion(criteria, 18, 17), false);
assert.equal(canMoveInterviewCriterion(criteria, 15, 16), true);
assert.equal(canMoveInterviewCriterion(criteria, 0, -1), false);
assert.equal(
  INTERVIEW_CRITERIA_ANSWER_TYPE_OPTIONS.map(([value]) => String(value)).includes('PERSONALITY_TEST_SUMMARY'),
  false,
);

console.log('HR interview criteria admin policy tests passed.');
