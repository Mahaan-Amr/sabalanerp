import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collateralCandidateExplanation, compensationTotalRials, normalizeCompensationComponents, unresolvedActivationRequirements, validateHiringCorrection, validateHiringQuestionnaire } from '../hrHiringRules';
import { validateHiringFileSignature } from '../hrHiringFileStorage';

const complete = {
  firstName: 'علی', lastName: 'احمدی', alias: 'ندارم', birthDate: '2000-01-01', birthPlace: 'تهران',
  militaryStatus: 'پایان خدمت', fatherName: 'رضا', fatherOccupation: 'بازنشسته', maritalStatus: 'SINGLE',
  address: 'تهران', postalCode: '1234567890', mobile: '09120000000', homePhone: 'ندارم',
  educationLevel: 'BACHELOR', educationLevelOther: '', fieldOfStudy: 'مدیریت', graduationYear: '1402', socialMedia: 'ندارم',
  hasSocialSecurityHistory: false, identityKind: 'IRANIAN', nationalCode: '0013546929',
  cooperationType: 'FULL_TIME', cooperationDuration: 'LONG_TERM'
};

assert.equal(validateHiringQuestionnaire(complete), true);
assert.throws(() => validateHiringQuestionnaire({ ...complete, postalCode: '123' }), /۱۰ رقم/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, nationalCode: '0012345678' }), /کد ملی/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, maritalStatus: 'MARRIED' }), /تعداد فرزندان/);
assert.equal(validateHiringQuestionnaire({ ...complete, identityKind: 'FOREIGN', nationalCode: '', foreignIdentityType: 'PASSPORT', foreignIdentityNumber: 'A123' }), true);
assert.throws(() => validateHiringQuestionnaire({ ...complete, educationLevel: 'OTHER', educationLevelOther: '' }), /عنوان مقطع/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, graduationYear: '1299' }), /سال اخذ مدرک/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, graduationYear: '9999' }), /سال اخذ مدرک/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, workHistory: [{ organization: 'سبلان', duration: '', lastPosition: '', lastSalaryBenefits: '' }] }), /ردیف سابقه کاری/);
assert.throws(() => validateHiringCorrection({ workHistory: [{ organization: 'سبلان', duration: '' }] }, ['workHistory']), /ردیف سابقه کاری/);

assert.equal(compensationTotalRials([{ label: 'حقوق پایه', amountRials: '1000' }, { label: 'مزایا', amountRials: 250 }]), 1250n);
assert.throws(() => compensationTotalRials([{ label: 'حقوق پایه', amountRials: '12.5' }]), /عدد صحیح ریال/);
assert.throws(() => compensationTotalRials([{ label: '', amountRials: '1000' }]), /عنوان/);

assert.deepEqual(normalizeCompensationComponents([
  { category: 'BASE_SALARY', label: 'عنوان دلخواه', amountRials: '1000' },
  { category: 'OTHER', label: '  حق ایاب و ذهاب ویژه  ', amountRials: '250' },
]), [
  { category: 'BASE_SALARY', label: 'حقوق پایه', amountRials: '1000' },
  { category: 'OTHER', label: 'حق ایاب و ذهاب ویژه', amountRials: '250' },
]);
assert.deepEqual(normalizeCompensationComponents([
  { category: 'BASE_SALARY', amountRials: '۱۲٬۳۴۵' },
  { category: 'OTHER', label: 'مزایای ویژه', amountRials: '١٠,٠٠٠' },
]).map((item) => item.amountRials), ['12345', '10000']);
assert.throws(
  () => normalizeCompensationComponents([{ category: 'OTHER', label: '  ', amountRials: '1000' }]),
  /عنوان مورد سایر/,
);
assert.throws(
  () => normalizeCompensationComponents([{ category: 'UNKNOWN', label: 'ناشناخته', amountRials: '1000' }]),
  /طبقه‌بندی/,
);
assert.throws(
  () => normalizeCompensationComponents([{ category: 'FIXED_BENEFIT', amountRials: '1000' }]),
  /حقوق پایه/,
);
assert.throws(
  () => normalizeCompensationComponents([{ category: 'BASE_SALARY', amountRials: '0' }]),
  /بزرگ‌تر از صفر/,
);
assert.throws(
  () => normalizeCompensationComponents([
    { category: 'BASE_SALARY', amountRials: '1000' },
    { category: 'ALLOWANCE', amountRials: '200' },
    { category: 'ALLOWANCE', amountRials: '300' },
  ]),
  /تکراری/,
);

const ready = unresolvedActivationRequirements({
  scheduledStartDate: new Date('2026-01-01'), identityClearance: 'APPROVED', collateralClearance: 'APPROVED',
  contractClearance: 'APPROVED', compensationClearance: 'APPROVED', hasPayrollParticipation: true,
  tasks: [{ title: 'قرارداد', activationBlocker: true, status: 'COMPLETE' }]
}, new Date('2026-01-02'));
assert.deepEqual(ready, []);

const blocked = unresolvedActivationRequirements({
  scheduledStartDate: new Date('2026-02-01'), identityClearance: 'IN_PROGRESS', collateralClearance: 'APPROVED',
  contractClearance: 'NOT_STARTED', compensationClearance: 'APPROVED', hasPayrollParticipation: false,
  tasks: [{ title: 'آموزش ایمنی', activationBlocker: true, status: 'PENDING' }]
}, new Date('2026-01-02'));
assert.deepEqual(blocked, ['تاریخ شروع', 'تأیید هویت', 'تأیید قرارداد', 'مشارکت حقوق و دستمزد', 'آموزش ایمنی']);

const uploadTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-hiring-upload-'));
try {
  const validPdf = path.join(uploadTestDir, 'valid.pdf');
  const spoofedPdf = path.join(uploadTestDir, 'spoofed.pdf');
  fs.writeFileSync(validPdf, Buffer.from('%PDF-1.4\n%%EOF', 'ascii'));
  fs.writeFileSync(spoofedPdf, Buffer.from('not a pdf', 'ascii'));
  assert.doesNotThrow(() => validateHiringFileSignature(validPdf, 'application/pdf'));
  assert.throws(() => validateHiringFileSignature(spoofedPdf, 'application/pdf'), /does not match/);
} finally {
  fs.rmSync(uploadTestDir, { recursive: true, force: true });
}

assert.equal(collateralCandidateExplanation('PROMISSORY_NOTE', '20000000'), 'پس از پذیرش پیشنهاد، امور مالی برای دریافت سفته به مبلغ 20,000,000 ریال با شما هماهنگ می‌کند.');
console.log('HR hiring rule tests passed.');
