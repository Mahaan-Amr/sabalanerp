import assert from "node:assert/strict";
import { normalizeInsuranceEnrollmentCommand } from "../hrInsuranceEnrollment";

const independent = normalizeInsuranceEnrollmentCommand({
  registrationPath: "INDEPENDENT_REQUEST",
  status: "IN_PROGRESS",
  effectiveDate: "1405/05/05",
  dueDate: "1405/05/31",
  communicationMethod: "PHONE",
  communicatedAt: "2026-07-27T10:00:00.000Z",
  note: "درخواست متقاضی ثبت شد",
});

assert.equal(independent.status, "EXEMPT");
assert.equal(independent.effectiveDate, null);
assert.equal(independent.dueDate, null);
assert.equal(independent.communicationMethod, "PHONE");

assert.throws(
  () =>
    normalizeInsuranceEnrollmentCommand({
      registrationPath: "INDEPENDENT_REQUEST",
      status: "EXEMPT",
      communicationMethod: "",
      communicatedAt: "",
    }),
  /روش و زمان اعلام درخواست/,
);

const company = normalizeInsuranceEnrollmentCommand({
  registrationPath: "COMPANY",
  status: "ACTIVE",
  effectiveDate: "2026-07-27",
  dueDate: "2026-07-30",
  communicationMethod: "PHONE",
  communicatedAt: "2026-07-27T10:00:00.000Z",
});

assert.equal(company.status, "ACTIVE");
assert.equal(company.communicationMethod, null);
assert.equal(company.communicatedAt, null);

assert.throws(
  () =>
    normalizeInsuranceEnrollmentCommand({
      registrationPath: "COMPANY",
      status: "ACTIVE",
      effectiveDate: "",
    }),
  /تاریخ شروع پوشش بیمه/,
);

console.log("HR insurance enrollment policy tests passed.");
