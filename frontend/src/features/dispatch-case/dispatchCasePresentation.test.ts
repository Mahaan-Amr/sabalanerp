import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchActionLabel,
  dispatchCaseReference,
  dispatchEventLabel,
  dispatchStationLabel,
  dispatchStatusLabel,
  evidenceDetailPresentation,
} from "./dispatchCasePresentation";

test("replaces dispatch workflow codes with plain Persian labels", () => {
  assert.equal(dispatchStatusLabel("EXIT_RECORDED"), "خروج از مجموعه ثبت شده");
  assert.equal(dispatchActionLabel("COMPLETE"), "فرایند ارسال تکمیل شده است");
  assert.equal(dispatchStationLabel("GUARD"), "گارد");
  assert.equal(
    dispatchEventLabel("MADE_AVAILABLE_FOR_LOADING"),
    "راننده برای بارگیری آماده شد",
  );
  assert.equal(
    dispatchEventLabel("CANDIDATE_CREATED"),
    "پرونده اسناد خروج ایجاد شد",
  );
});

test("unknown backend codes are never exposed on the normal user surface", () => {
  assert.equal(
    dispatchStatusLabel("NEW_BACKEND_STATUS"),
    "وضعیت در سامانه ثبت شده",
  );
  assert.equal(
    dispatchEventLabel("NEW_BACKEND_EVENT"),
    "یک رویداد سیستمی ثبت شد",
  );
});

test("turns loading numbers into a Persian, human-readable reference", () => {
  assert.equal(
    dispatchCaseReference("L-20260920-0001"),
    "بارگیری شماره ۱ · ۱۴۰۵/۶/۲۹",
  );
  assert.equal(dispatchCaseReference(null), "بدون شماره بارگیری");
});

test("does not expose nonstandard references on the normal surface", () => {
  assert.equal(dispatchCaseReference("LD-TEST-1"), "شماره بارگیری ثبت‌شده");
});

test("presents evidence as translated fields and keeps identifiers in technical details", () => {
  const result = evidenceDetailPresentation({
    fromStatus: null,
    toStatus: "WAITING_AT_GATE",
    reason: null,
    snapshotSchemaVersion: 1,
    integrityHash: "abc123",
  });

  assert.deepEqual(result.summary, [
    { label: "وضعیت قبلی", value: "ثبت نشده" },
    { label: "وضعیت جدید", value: "در انتظار پذیرش گارد" },
  ]);
  assert.deepEqual(result.technical, [
    { label: "نسخه ساختار ثبت", value: "۱" },
    { label: "کد صحت داده", value: "abc۱۲۳" },
  ]);
});
