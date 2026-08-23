import assert from "node:assert/strict";
import {
  fromIsoDate,
  fromIsoDateTime,
  isCompletePersianDateTime,
  toIsoDate,
  toIsoDateTime,
} from "./hrUi";

assert.equal(toIsoDate("۱۴۰۵/۰۵/۰۱"), "2026-07-23");
assert.equal(fromIsoDate("2026-07-23"), "1405/05/01");
assert.equal(fromIsoDate("2026-07-23T23:30:00.000Z"), "1405/05/01");
assert.equal(
  fromIsoDateTime("2026-07-23T09:00:00.000Z"),
  "1405/05/01 12:30",
);
assert.equal(
  toIsoDateTime("1405/05/01 12:30"),
  "2026-07-23T09:00:00.000Z",
);
assert.equal(isCompletePersianDateTime("۱۴۰۵/۰۵/۰۱ ۱۲:۳۰"), true);
assert.equal(isCompletePersianDateTime("1405/05/01"), false);

console.log("HR Jalali boundary tests passed.");
