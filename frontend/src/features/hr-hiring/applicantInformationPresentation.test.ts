import assert from "node:assert/strict";
import { applicantBirthDateDisplay } from "./applicantInformationPresentation";

assert.equal(applicantBirthDateDisplay("1995-01-02"), "1373/10/12");
assert.equal(applicantBirthDateDisplay(null), "—");

console.log("Applicant information presentation tests passed.");
