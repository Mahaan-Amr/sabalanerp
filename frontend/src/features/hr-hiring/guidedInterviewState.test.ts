import assert from "node:assert/strict";
import { advanceGuidedCriterion, guidedInterviewSummary } from "./guidedInterviewState";

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

console.log("Guided HR interview state tests passed.");
