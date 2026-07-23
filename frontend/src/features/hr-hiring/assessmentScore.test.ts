import assert from "node:assert/strict";
import { parseLocalizedAssessmentScore } from "./assessmentScore";

assert.deepEqual(parseLocalizedAssessmentScore("۰"), { value: 0 });
assert.deepEqual(parseLocalizedAssessmentScore("۱۰۰"), { value: 100 });
assert.deepEqual(parseLocalizedAssessmentScore("٧٥٫٢٥"), { value: 75.25 });
assert.deepEqual(parseLocalizedAssessmentScore("25.50"), { value: 25.5 });
assert.match(parseLocalizedAssessmentScore("-1").error || "", /۰ تا ۱۰۰/);
assert.match(parseLocalizedAssessmentScore("100.001").error || "", /دو رقم اعشار/);
assert.match(parseLocalizedAssessmentScore("abc").error || "", /عدد معتبر/);

console.log("HR localized assessment score tests passed.");
