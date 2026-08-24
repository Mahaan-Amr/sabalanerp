import assert from "node:assert/strict";
import {
  EDUCATION_LEVEL_OPTIONS,
  applicantFormErrors,
  normalizeLegacyEducation,
} from "./applicantFormPolicy";

const complete = {
  firstName: "علی",
  lastName: "احمدی",
  alias: "ندارم",
  birthDate: "1370/01/01",
  birthPlace: "تهران",
  militaryStatus: "پایان خدمت",
  fatherName: "رضا",
  fatherOccupation: "بازنشسته",
  maritalStatus: "SINGLE",
  address: "تهران",
  postalCode: "1234567890",
  mobile: "09120000000",
  homePhone: "ندارم",
  educationLevel: "BACHELOR",
  educationLevelOther: "",
  fieldOfStudy: "مدیریت",
  graduationYear: "1402",
  socialMedia: "ندارم",
  hasSocialSecurityHistory: false,
  identityKind: "IRANIAN",
  nationalCode: "0013546929",
  cooperationType: "FULL_TIME",
  cooperationDuration: "LONG_TERM",
  workHistory: [{ organization: "", duration: "", lastPosition: "", lastSalaryBenefits: "" }],
  skills: [{ name: "", familiarity: "", proficiency: "" }],
  languages: [{ name: "", level: "", proficiency: "" }],
};

assert.deepEqual(applicantFormErrors(complete, 1405), []);
assert.match(applicantFormErrors({ ...complete, mobile: "0912" }, 1405)[0].message, /۱۱ رقم/);
assert.match(applicantFormErrors({ ...complete, postalCode: "123" }, 1405)[0].message, /۱۰ رقم/);
assert.match(applicantFormErrors({ ...complete, graduationYear: "1406" }, 1405)[0].message, /۱۳۰۰ تا ۱۴۰۵/);
assert.match(applicantFormErrors({ ...complete, educationLevel: "OTHER" }, 1405)[0].message, /عنوان مقطع/);
assert.match(applicantFormErrors({
  ...complete,
  workHistory: [{ organization: "سبلان", duration: "", lastPosition: "", lastSalaryBenefits: "" }],
}, 1405)[0].message, /ردیف سابقه کاری/);

assert.deepEqual(normalizeLegacyEducation("کارشناسی"), {
  educationLevel: "BACHELOR",
  educationLevelOther: "",
});
assert.deepEqual(normalizeLegacyEducation("فوق دیپلم قدیمی"), {
  educationLevel: "OTHER",
  educationLevelOther: "فوق دیپلم قدیمی",
});
assert.ok(EDUCATION_LEVEL_OPTIONS.some((option) => option.value === "OTHER"));

console.log("Applicant form policy tests passed.");
