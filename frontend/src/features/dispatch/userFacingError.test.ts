import assert from "node:assert/strict";
import test from "node:test";
import { userFacingError } from "./userFacingError";

test("keeps a readable Persian backend message", () => {
  assert.equal(
    userFacingError(
      { response: { data: { error: "این عملیات در وضعیت فعلی مجاز نیست." } } },
      "خطا",
    ),
    "این عملیات در وضعیت فعلی مجاز نیست.",
  );
});

test("replaces English and technical backend messages with the local fallback", () => {
  assert.equal(
    userFacingError(new Error("Internal server error"), "عملیات انجام نشد."),
    "عملیات انجام نشد.",
  );
  assert.equal(
    userFacingError(
      { response: { data: { error: "وضعیت EXIT_RECORDED معتبر نیست." } } },
      "عملیات انجام نشد.",
    ),
    "عملیات انجام نشد.",
  );
});
