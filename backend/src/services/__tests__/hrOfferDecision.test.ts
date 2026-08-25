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
    communicatedOn: "2026-07-23",
    offlineReason: "عدم دسترسی متقاضی به اینترنت",
    note: "",
  }, new Date("2026-07-24T08:00:00.000Z")).decision,
  "ACCEPTED",
);
assert.throws(() => validateOfflineOfferDecision({ decision: "ACCEPTED" }), /الزامی/);
for (const communicatedOn of ["2026-07-25", "2026-02-31", "1405/05/01", "2026-07-23T12:30:00Z"]) {
  assert.throws(() => validateOfflineOfferDecision({
    decision: "ACCEPTED",
    communicationMethod: "PHONE",
    communicatedOn,
    offlineReason: "عدم دسترسی متقاضی به اینترنت",
    note: "",
  }, new Date("2026-07-24T08:00:00.000Z")), /تاریخ/);
}

assert.equal(validateOfflineOfferDecision({
  decision: "DECLINED",
  communicationMethod: "IN_PERSON",
  communicatedOn: "2026-07-23",
  offlineReason: "ثبت حضوری",
  declineCategory: "ROLE",
  note: "",
}, new Date("2026-07-24T08:00:00.000Z")).declineCategory, "ROLE");
assert.throws(() => validateOfflineOfferDecision({
  decision: "DECLINED",
  communicationMethod: "PHONE",
  communicatedOn: "2026-07-23",
  offlineReason: "تماس تلفنی",
  note: "",
}, new Date("2026-07-24T08:00:00.000Z")), /دلیل رد/);

console.log("HR offer decision policy tests passed.");
