import assert from "node:assert/strict";
import {
  buildCandidateCorrectionMessage,
  normalizeCandidateCorrectionRequest,
} from "../hrCandidateCorrection";
import { validateHiringCorrection } from "../hrHiringRules";

const request = normalizeCandidateCorrectionRequest({
  fields: [
    { fieldKey: "nationalCode", explanation: "کد ملی با کارت ملی یکسان نیست." },
    { fieldKey: "postalCode", explanation: "کد پستی را با مدرک نشانی بررسی کنید." },
  ],
});

assert.deepEqual(request, [
  {
    fieldKey: "nationalCode",
    label: "کد ملی",
    explanation: "کد ملی با کارت ملی یکسان نیست.",
  },
  {
    fieldKey: "postalCode",
    label: "کد پستی",
    explanation: "کد پستی را با مدرک نشانی بررسی کنید.",
  },
]);

const message = buildCandidateCorrectionMessage(request, false);
assert.match(message, /کد ملی/);
assert.match(message, /کد پستی/);
assert.doesNotMatch(message, /nationalCode|postalCode/);
assert.doesNotMatch(message, /\d{6}/);

const replacementMessage = buildCandidateCorrectionMessage(request, true);
assert.match(replacementMessage, /کد ورود جدید/);

assert.throws(
  () =>
    normalizeCandidateCorrectionRequest({
      fields: [{ fieldKey: "nationalCode", explanation: " " }],
    }),
  /توضیح فارسی/,
);
assert.throws(
  () =>
    normalizeCandidateCorrectionRequest({
      fields: [{ fieldKey: "unknown", explanation: "مقدار را اصلاح کنید." }],
    }),
  /فیلد/,
);

assert.equal(
  validateHiringCorrection(
    { identityKind: "IRANIAN", nationalCode: "0013547828", postalCode: "1234567890" },
    ["nationalCode", "postalCode"],
  ),
  true,
);
assert.throws(
  () => validateHiringCorrection({ identityKind: "IRANIAN", nationalCode: "0013547829" }, ["nationalCode"]),
  /کد ملی/,
);
assert.throws(
  () => validateHiringCorrection({ postalCode: "" }, ["postalCode"]),
  /ناقص/,
);

console.log("HR candidate correction tests passed.");
