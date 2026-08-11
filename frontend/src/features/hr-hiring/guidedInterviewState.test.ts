import assert from "node:assert/strict";
import { advanceGuidedCriterion, guidedInterviewSummary } from "./guidedInterviewState";
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

const stability = interviewCriteria.find((criterion) => criterion.id === "stability")!;
const stabilityAnswer = createInitialInterviewState().answers.stability;
assert.equal(criterionIsComplete(stability, { ...stabilityAnswer, score: 4, note: "" }), true);
assert.equal(criterionIsComplete(stability, { ...stabilityAnswer, score: "UNASSESSED", note: "" }), true);

console.log("Guided HR interview state tests passed.");
