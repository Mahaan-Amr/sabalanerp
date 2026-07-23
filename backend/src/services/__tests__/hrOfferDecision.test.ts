import assert from "node:assert/strict";
import { normalizePersianFullName, validateOfflineOfferDecision } from "../hrOfferDecision";

assert.equal(normalizePersianFullName("  علی\u200c آزمون  "), "علی آزمون");
assert.equal(normalizePersianFullName("علي ازمون"), "علی ازمون");
assert.equal(normalizePersianFullName("كيان"), "کیان");
assert.notEqual(normalizePersianFullName("آزمون علی"), normalizePersianFullName("علی آزمون"));

assert.deepEqual(
  validateOfflineOfferDecision({
    decision: "ACCEPTED",
    communicationMethod: "PHONE",
    communicatedAt: "2026-07-23T08:00:00.000Z",
    offlineReason: "عدم دسترسی متقاضی به اینترنت",
    confirmedCandidateInformation: "متقاضی آزمایشی",
    note: "پیشنهاد کامل برای متقاضی خوانده و تأیید شد.",
  }).decision,
  "ACCEPTED",
);
assert.throws(() => validateOfflineOfferDecision({ decision: "ACCEPTED" }), /الزامی/);

console.log("HR offer decision policy tests passed.");
