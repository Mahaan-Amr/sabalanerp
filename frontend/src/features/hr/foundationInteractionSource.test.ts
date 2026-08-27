import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  foundationDependencyLabel,
  isFoundationDeleteCredentialError,
  personnelAssignmentHref,
} from "./foundationInteraction";

const featureDirectory = dirname(fileURLToPath(import.meta.url));
const frontendSource = resolve(featureDirectory, "../..");
const readSource = (relativePath: string) => readFileSync(resolve(frontendSource, relativePath), "utf8");

const personnelPage = readSource("app/dashboard/hr/personnel/page.tsx");
const positionPage = readSource("app/dashboard/hr/structure/positions/[id]/page.tsx");
const structurePage = readSource("app/dashboard/hr/structure/page.tsx");
const apiSource = readSource("lib/api.ts");

assert.doesNotMatch(personnelPage, /voidAssignment\(/, "the personnel UI must not offer a new void action");
assert.doesNotMatch(apiSource, /voidAssignment:/, "the frontend API must not expose the retired void action");
assert.match(positionPage, /personnelAssignmentHref/, "position assignments must link to the focused personnel record");
assert.match(structurePage, /deleteError/, "permanent-delete failures must have modal-local error state");
assert.match(structurePage, /foundationDependencyLabel/, "dependency actions must use centralized Persian labels");

assert.equal(foundationDependencyLabel("assignments"), "تخصیص‌ها");
assert.equal(foundationDependencyLabel("subordinatePositions"), "جایگاه‌های زیرمجموعه");
assert.equal(foundationDependencyLabel("historicalStructureChanges"), "تغییرات تاریخی ساختار");
assert.equal(foundationDependencyLabel("unknown-kind"), "وابستگی سازمانی");
assert.equal(isFoundationDeleteCredentialError({ response: { status: 403, data: { error: "رمز عبور کاربر مجاز صحیح نیست." } } }), true);
assert.equal(isFoundationDeleteCredentialError({ response: { status: 403, data: { error: "مجوز کافی نیست." } } }), false);
assert.equal(isFoundationDeleteCredentialError({ response: { status: 409, data: { error: "رمز عبور کاربر مجاز صحیح نیست." } } }), false);
assert.equal(
  personnelAssignmentHref("person 1", "position/1"),
  "/dashboard/hr/personnel?focus=person+1&origin=%2Fdashboard%2Fhr%2Fstructure%2Fpositions%2Fposition%2F1",
);
