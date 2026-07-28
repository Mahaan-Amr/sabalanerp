import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hiringDetailSource = fs.readFileSync(
  path.join(process.cwd(), "src", "app", "dashboard", "hr", "hiring", "[id]", "page.tsx"),
  "utf8",
);

assert.doesNotMatch(
  hiringDetailSource,
  /type="datetime-local"\s+value=\{requirement\.dueAt\}/,
  "the company-management checklist must not expose the browser Gregorian datetime input",
);
assert.match(
  hiringDetailSource,
  /<HrPersianCalendar[\s\S]{0,300}value=\{requirement\.dueAt\}[\s\S]{0,300}showTime/,
  "the company-management checklist deadline must use the HR-scoped Jalali date/time picker",
);

console.log("HR company-management checklist calendar test passed.");
