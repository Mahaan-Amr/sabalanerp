import assert from "node:assert/strict";
import { buildSellerProfileIndicators, validateProfileDraft } from "./performanceProfileDraftModel";

const indicators = buildSellerProfileIndicators([
  {
    code: "NET_CONTRACT_VALUE", familyCode: "SALES_CONTRIBUTION", titleFa: "ارزش قرارداد",
    unitFa: "درصد", direction: "HIGHER_IS_BETTER", weightPercent: 14,
    sourceKind: "SYSTEM", minimumSampleCount: 1,
  },
  {
    code: "SUPERVISOR_RESPECT", familyCode: "BEHAVIOR", titleFa: "رفتار محترمانه",
    unitFa: "امتیاز", direction: "CAPPED_RATE", weightPercent: 86,
    sourceKind: "SUPERVISOR", minimumSampleCount: 1,
  },
]);

assert.ok(indicators.every((indicator) => indicator.target.trim()), "seller template must fill every required target");
assert.equal(indicators[0].target, "100", "system achievement factors receive an editable provisional target");
assert.equal(indicators[1].target, "75", "judgement factors receive an editable provisional target");
assert.deepEqual(validateProfileDraft({
  nameFa: "الگوی فروشندگان", jobId: "job-sales", effectivePeriodKey: "1405-H2", indicators,
}), []);
assert.equal(validateProfileDraft({
  nameFa: "", jobId: "", effectivePeriodKey: "", indicators: [{ ...indicators[0], target: "" }],
})[0]?.fieldId, "profile-name", "validation returns the first focusable invalid field in form order");
console.log("Performance profile draft model tests passed.");
