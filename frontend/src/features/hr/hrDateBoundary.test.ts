import assert from "node:assert/strict";
import {
  fromIsoDate,
  toIsoDate,
  toIsoDateTime,
} from "./hrUi";

assert.equal(toIsoDate("۱۴۰۵/۰۵/۰۱"), "2026-07-23");
assert.equal(fromIsoDate("2026-07-23"), "1405/05/01");
assert.equal(fromIsoDate("2026-07-23T23:30:00.000Z"), "1405/05/01");
assert.equal(
  toIsoDateTime("1405/05/01 12:30"),
  "2026-07-23T09:00:00.000Z",
);

console.log("HR Jalali boundary tests passed.");
