import assert from "node:assert/strict";
import {
  advanceGuidedCriterion,
  guidedInterviewSummary,
  interviewCompletionFocusTarget,
  shouldShowNextCriterion,
} from "./guidedInterviewState";
import { createInitialInterviewState, criterionIsComplete, interviewCriteria } from "./prototype/interviewPrototypeData";

const criteria = ["appearance", "teamwork", "companion"];
assert.equal(advanceGuidedCriterion(criteria, "appearance", "appearance"), "teamwork");
assert.equal(advanceGuidedCriterion(criteria, "teamwork", "teamwork"), "companion");
assert.equal(advanceGuidedCriterion(criteria, "companion", "companion"), "companion");
assert.deepEqual(guidedInterviewSummary(criteria, {
  appearance: 4,
  teamwork: "UNASSESSED",
  companion: 5,
}), {
  completed: 3,
  total: 3,
  finalCriterionId: "companion",
  finalCriterionValue: 5,
});
assert.equal(shouldShowNextCriterion(1, 3), true);
assert.equal(shouldShowNextCriterion(2, 3), false, "the next button is absent on the final criterion");
assert.equal(interviewCompletionFocusTarget({
  criteriaComplete: true,
  customCriteriaComplete: true,
  summaryComplete: false,
}), "summary");
assert.equal(interviewCompletionFocusTarget({
  criteriaComplete: true,
  customCriteriaComplete: false,
  summaryComplete: true,
}), "custom-criterion");
assert.equal(interviewCompletionFocusTarget({
  criteriaComplete: true,
  customCriteriaComplete: true,
  summaryComplete: true,
}), "completion");

const stability = interviewCriteria.find((criterion) => criterion.id === "stability")!;
const stabilityAnswer = createInitialInterviewState().answers.stability;
assert.equal(criterionIsComplete(stability, { ...stabilityAnswer, score: 4, note: "" }), true);
assert.equal(criterionIsComplete(stability, { ...stabilityAnswer, score: "UNASSESSED", note: "" }), true);
assert.equal(criterionIsComplete(stability, { ...stabilityAnswer, score: 6 as any }), false);

const selfView = interviewCriteria.find((criterion) => criterion.id === "selfView")!;
const selfViewAnswer = createInitialInterviewState().answers.selfView;
assert.equal(criterionIsComplete(selfView, {
  ...selfViewAnswer,
  strengths: ["یک"],
  weaknesses: ["یک"],
}), false);

console.log("Guided HR interview state tests passed.");
