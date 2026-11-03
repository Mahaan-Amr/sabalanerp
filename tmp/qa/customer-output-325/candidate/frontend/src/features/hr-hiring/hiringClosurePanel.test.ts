import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hiringDetailSource = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "dashboard",
    "hr",
    "hiring",
    "[id]",
    "page.tsx",
  ),
  "utf8",
);

assert.match(
  hiringDetailSource,
  /title="مختومه‌کردن پرونده استخدام"/,
  "the general closure action must not be presented as a second final-rejection workflow",
);

assert.match(
  hiringDetailSource,
  /label="ثبت نتیجه و مختومه‌کردن پرونده"[\s\S]{0,180}className="w-fit self-end justify-self-start"/,
  "the destructive closure button must keep its intrinsic control size inside the grid",
);

console.log("HR hiring closure panel regression test passed.");
