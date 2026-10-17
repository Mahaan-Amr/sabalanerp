import assert from "node:assert/strict";
import test from "node:test";
import { HrVehicleError, ordinaryChangeInstant } from "../hrVehicleOperations";

const rejectedPast = (error: unknown) =>
  error instanceof HrVehicleError && error.statusCode === 400 &&
  error.message.includes("تاریخ گذشته");

for (const sample of [
  { at: "2026-10-17T20:30:00.000Z", today: "2026-10-18", yesterday: "2026-10-17" },
  { at: "2026-10-17T21:00:00.000Z", today: "2026-10-18", yesterday: "2026-10-17" },
  { at: "2026-10-17T23:59:59.999Z", today: "2026-10-18", yesterday: "2026-10-17" },
  { at: "2026-10-18T00:00:00.000Z", today: "2026-10-18", yesterday: "2026-10-17" },
  { at: "2026-12-31T20:30:00.000Z", today: "2027-01-01", yesterday: "2026-12-31" },
]) {
  test(`Tehran date-only commands use the local day at ${sample.at}`, () => {
    const at = new Date(sample.at);
    for (const allowFuture of [false, true]) {
      assert.equal(ordinaryChangeInstant(sample.today, at, allowFuture), at);
      assert.throws(() => ordinaryChangeInstant(sample.yesterday, at, allowFuture), rejectedPast);
    }
  });
}

test("the Tehran day changes at local midnight rather than UTC midnight", () => {
  const beforeMidnight = new Date("2026-10-17T20:29:59.999Z");
  assert.equal(ordinaryChangeInstant("2026-10-17", beforeMidnight), beforeMidnight);
  assert.throws(() => ordinaryChangeInstant("2026-10-18", beforeMidnight), /زمان آینده/);
  assert.equal(ordinaryChangeInstant("2026-10-18", beforeMidnight, true).toISOString(), "2026-10-17T20:30:00.000Z");
});

test("NOW and omitted values retain the exact recording instant", () => {
  const at = new Date("2026-10-17T21:00:00.123Z");
  for (const value of [undefined, null, "", "NOW"]) {
    assert.equal(ordinaryChangeInstant(value, at), at);
  }
});

test("future date-only plans start at Tehran midnight and require scheduling authority", () => {
  const at = new Date("2026-10-17T21:00:00.000Z");
  assert.throws(() => ordinaryChangeInstant("2026-10-19", at), /زمان آینده/);
  assert.equal(ordinaryChangeInstant("2026-10-19", at, true).toISOString(), "2026-10-18T20:30:00.000Z");
});

test("explicit timestamp offsets preserve their instant and never permit backdating", () => {
  const at = new Date("2026-10-17T21:00:00.000Z");
  assert.throws(() => ordinaryChangeInstant("2026-10-18T00:29:59+03:30", at, true), rejectedPast);
  assert.equal(ordinaryChangeInstant("2026-10-18T00:31:00+03:30", at, true).toISOString(), "2026-10-17T21:01:00.000Z");
  assert.throws(() => ordinaryChangeInstant("not-a-date", at, true), /تاریخ انتخاب‌شده معتبر نیست/);
});
