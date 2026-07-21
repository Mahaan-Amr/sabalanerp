import assert from 'node:assert/strict';
import {
  applicantOtpHash,
  applicantSubjectHash,
  generateApplicantOtp,
  normalizeApplicantMobile,
  normalizeApplicantOtp
} from '../hrCandidateAccess';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hmac';

assert.equal(normalizeApplicantMobile('0912 345 6789'), '09123456789');
assert.equal(normalizeApplicantMobile('+98 912 345 6789'), '09123456789');
assert.equal(normalizeApplicantMobile('0098-912-345-6789'), '09123456789');
assert.equal(normalizeApplicantMobile('۹۱۲۳۴۵۶۷۸۹'), '09123456789');
assert.equal(normalizeApplicantMobile('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
assert.equal(normalizeApplicantMobile('02112345678'), null);

assert.equal(normalizeApplicantOtp('۳۰۲۲۸۸'), '302288');
assert.equal(normalizeApplicantOtp('٣٠٢٢٨٨'), '302288');
assert.equal(normalizeApplicantOtp('30228'), null);
assert.equal(normalizeApplicantOtp('3022887'), null);

assert.equal(applicantOtpHash('09123456789', '302288'), applicantOtpHash('09123456789', '302288'));
assert.notEqual(applicantOtpHash('09123456789', '302288'), applicantOtpHash('09123456789', '302289'));
assert.notEqual(applicantOtpHash('09123456789', '302288'), applicantOtpHash('09353456789', '302288'));
assert.notEqual(applicantSubjectHash('PHONE', '09123456789'), applicantSubjectHash('IP', '09123456789'));

for (let index = 0; index < 100; index += 1) assert.match(generateApplicantOtp(), /^\d{6}$/);

console.log('HR candidate access tests passed.');
