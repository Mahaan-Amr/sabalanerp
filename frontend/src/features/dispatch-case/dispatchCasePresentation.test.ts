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

test("distinguishes waybill-only and combined cancellation without exposing command identifiers", () => {
  assert.equal(dispatchEventLabel("VOID_WAYBILL:waybill-1"), "حواله خروج باطل شد");
  assert.equal(dispatchEventLabel("VOID_WAYBILL_AND_INVOICE:waybill-1:invoice-1"), "حواله خروج و فاکتور فروش باطل شدند");
  assert.equal(dispatchEventLabel("VOID_WAYBILL_AND_INVOICE:waybill-1:"), "حواله خروج باطل شد");
  assert.equal(dispatchEventLabel("CANDIDATE_WITHDRAWN"), "درخواست صدور اسناد خروج پس گرفته شد");
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

test("biometric history distinguishes a failed attempt, a match and missing historical evidence", () => {
  const type = "BIOMETRIC_ATTEMPT_RECORDED";
  assert.match(dispatchEventLabel(type, { result: { errorCategory: "CAPTURE_TIMEOUT" } }), /ناموفق.*مهلت/);
  assert.match(dispatchEventLabel(type, {
    match: { state: "MATCH" }, captureQuality: { state: "ACCEPTED" }, liveness: { state: "LIVE" },
  }), /تطابق داشت/);
  assert.equal(dispatchEventLabel(type), "نتیجه بررسی اثر انگشت ثبت شد");
});
