import assert from "node:assert/strict";
import {
  assessmentTypeLabel,
  authorityLabel,
  hrDisplayLabel,
} from "./hrDisplay";

assert.equal(authorityLabel("HR_PROCESSOR"), "کارشناس منابع انسانی");
assert.equal(hrDisplayLabel("APPROVED"), "تأییدشده");
assert.equal(hrDisplayLabel("ASSESSMENT"), "ارزیابی");
assert.equal(hrDisplayLabel("CLOSED"), "بسته‌شده");
assert.equal(
  assessmentTypeLabel("BIG_FIVE"),
  "BIG FIVE (ارزیابی پنج عامل بزرگ شخصیت)",
);
assert.equal(hrDisplayLabel("UNKNOWN_INTERNAL_VALUE"), "خطای طبقه‌بندی");
assert.equal(assessmentTypeLabel("OTHER"), "سایر");

console.log("HR Persian display tests passed.");
