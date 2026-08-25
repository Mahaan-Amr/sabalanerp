import assert from "node:assert/strict";
import { normalizeYearOnlyValue, yearOnlyOptions } from "./persianCalendarYearPolicy";

assert.equal(normalizeYearOnlyValue("۱۴۰۲", 1300, 1405), "1402");
assert.equal(normalizeYearOnlyValue("1406", 1300, 1405), "");
assert.equal(normalizeYearOnlyValue("1402/01/01", 1300, 1405), "");
assert.deepEqual(yearOnlyOptions(1403, 1405), [1405, 1404, 1403]);

console.log("Persian calendar year-only policy tests passed.");
