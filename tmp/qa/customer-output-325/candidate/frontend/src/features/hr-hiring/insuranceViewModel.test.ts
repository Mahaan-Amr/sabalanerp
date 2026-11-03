import assert from "node:assert/strict";
import { insuranceSubmissionBlocker } from "./insuranceViewModel";

assert.equal(
  insuranceSubmissionBlocker({
    registrationPath: "COMPANY",
    status: "ACTIVE",
    effectiveDate: "",
    communicationMethod: "",
    communicatedAt: "",
  }),
  "effective-date-required",
);
assert.equal(
  insuranceSubmissionBlocker({
    registrationPath: "INDEPENDENT_REQUEST",
    status: "NOT_STARTED",
    effectiveDate: "",
    communicationMethod: "PHONE",
    communicatedAt: "",
  }),
  "communication-required",
);
assert.equal(
  insuranceSubmissionBlocker({
    registrationPath: "INDEPENDENT_REQUEST",
    status: "NOT_STARTED",
    effectiveDate: "",
    communicationMethod: "PHONE",
    communicatedAt: "1405/05/01",
  }),
  null,
);

assert.equal(
  insuranceSubmissionBlocker({
    registrationPath: "INDEPENDENT_REQUEST",
    status: "NOT_STARTED",
    effectiveDate: "",
    communicationMethod: null,
    communicatedAt: null,
  }),
  "communication-required",
  "nullable company-registration evidence must not crash when switching to independent registration",
);

console.log("Insurance view-model tests passed.");
