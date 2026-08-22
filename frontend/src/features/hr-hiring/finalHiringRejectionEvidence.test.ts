import assert from "node:assert/strict";
import {
  FINAL_REJECTION_EVIDENCE_HELP,
  buildFinalRejectionResultReferences,
  latestCompletedAssessmentResults,
  formalAssessmentLabel,
} from "./finalHiringRejectionEvidence";

const plans = [{
  results: [
    { id: "disc-1", assessmentKind: "DISC", resultVersion: 1, status: "COMPLETED" },
    { id: "disc-2", assessmentKind: "DISC", resultVersion: 2, status: "PENDING" },
    { id: "eq-1", assessmentKind: "EQ", resultVersion: 1, status: "COMPLETED" },
  ],
}];

const completed = latestCompletedAssessmentResults(plans);
assert.deepEqual(completed.map(({ id }) => id), ["disc-1", "eq-1"]);
assert.deepEqual(buildFinalRejectionResultReferences(completed, ["eq-1"]), [
  { assessmentKind: "EQ", resultVersion: 1 },
]);
assert.match(formalAssessmentLabel("DISC"), /الگوی رفتاری دیسک/);
assert.match(formalAssessmentLabel("EQ"), /هوش هیجانی/);
assert.match(formalAssessmentLabel("BIG_FIVE"), /پنج عامل بزرگ شخصیت/);
assert.match(FINAL_REJECTION_EVIDENCE_HELP, /تغییر یا حذف نمی‌کند/);

console.log("Final hiring rejection evidence tests passed.");
