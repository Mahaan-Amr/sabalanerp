import assert from 'node:assert/strict';
import { compensationTotalRials, unresolvedActivationRequirements, validateHiringQuestionnaire } from '../hrHiringRules';

const complete = {
  firstName: 'علی', lastName: 'احمدی', alias: 'ندارم', birthDate: '2000-01-01', birthPlace: 'تهران',
  militaryStatus: 'پایان خدمت', fatherName: 'رضا', fatherOccupation: 'بازنشسته', maritalStatus: 'SINGLE',
  address: 'تهران', postalCode: '1234567890', mobile: '09120000000', homePhone: 'ندارم',
  educationLevel: 'کارشناسی', fieldOfStudy: 'مدیریت', graduationYear: '1402', socialMedia: 'ندارم',
  hasSocialSecurityHistory: false, identityKind: 'IRANIAN', nationalCode: '0013546929',
  cooperationType: 'FULL_TIME', cooperationDuration: 'LONG_TERM'
};

assert.equal(validateHiringQuestionnaire(complete), true);
assert.throws(() => validateHiringQuestionnaire({ ...complete, postalCode: '123' }), /۱۰ رقم/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, nationalCode: '0012345678' }), /کد ملی/);
assert.throws(() => validateHiringQuestionnaire({ ...complete, maritalStatus: 'MARRIED' }), /تعداد فرزندان/);
assert.equal(validateHiringQuestionnaire({ ...complete, identityKind: 'FOREIGN', nationalCode: '', foreignIdentityType: 'PASSPORT', foreignIdentityNumber: 'A123' }), true);

assert.equal(compensationTotalRials([{ label: 'حقوق پایه', amountRials: '1000' }, { label: 'مزایا', amountRials: 250 }]), 1250n);
assert.throws(() => compensationTotalRials([{ label: 'حقوق پایه', amountRials: '12.5' }]), /عدد صحیح ریال/);
assert.throws(() => compensationTotalRials([{ label: '', amountRials: '1000' }]), /عنوان/);

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

console.log('HR hiring rule tests passed.');
