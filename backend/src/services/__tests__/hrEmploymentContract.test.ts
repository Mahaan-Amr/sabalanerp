import assert from "node:assert/strict";
import {
  assertPaperContractDraft,
  assertPaperContractReviewable,
  paperContractReviewState,
} from "../hrEmploymentContract";

assert.doesNotThrow(() =>
  assertPaperContractDraft({
    contractNumber: "HR-1405-001",
    effectiveFrom: new Date("2026-07-27T00:00:00.000Z"),
    effectiveTo: new Date("2027-07-26T00:00:00.000Z"),
    hasFile: true,
  }),
);

assert.throws(
  () =>
    assertPaperContractDraft({
      contractNumber: "HR-1405-001",
      effectiveFrom: new Date("2026-07-27T00:00:00.000Z"),
      effectiveTo: null,
      hasFile: true,
    }),
  /تاریخ پایان اعتبار قرارداد الزامی است/,
);

assert.throws(
  () =>
    assertPaperContractDraft({
      contractNumber: "HR-1405-001",
      effectiveFrom: new Date("2027-07-27T00:00:00.000Z"),
      effectiveTo: new Date("2026-07-26T00:00:00.000Z"),
      hasFile: true,
    }),
  /پیش از تاریخ شروع/,
);

const submitted = {
  uploadedBy: "recorder-1",
  submittedAt: new Date("2026-07-27T10:00:00.000Z"),
  returnedAt: null,
  approvedAt: null,
};

assert.equal(paperContractReviewState(submitted), "SUBMITTED");
assert.doesNotThrow(() =>
  assertPaperContractReviewable(submitted, {
    actorId: "manager-1",
    isLatest: true,
  }),
);
assert.throws(
  () =>
    assertPaperContractReviewable(
      { ...submitted, submittedAt: null },
      { actorId: "manager-1", isLatest: true },
    ),
  /ابتدا برای بررسی ارسال/,
);
assert.throws(
  () =>
    assertPaperContractReviewable(submitted, {
      actorId: "recorder-1",
      isLatest: true,
    }),
  /ثبت‌کننده.*تأیید/,
);
assert.equal(
  paperContractReviewState({
    ...submitted,
    returnedAt: new Date("2026-07-27T11:00:00.000Z"),
  }),
  "RETURNED",
);

console.log("HR employment contract policy tests passed.");
