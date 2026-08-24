import assert from 'node:assert/strict';
import {
  applicantOtpHash,
  decryptApplicantOtp,
  encryptApplicantOtp,
  applicantSubjectHash,
  generateApplicantOtp,
  normalizeApplicantMobile,
  normalizeApplicantOtp,
  projectCurrentApplicantOtp
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

const encryptedOtp = encryptApplicantOtp('09123456789', '302288');
assert.notEqual(encryptedOtp, '302288');
assert.equal(decryptApplicantOtp('09123456789', encryptedOtp), '302288');
assert.equal(decryptApplicantOtp('09353456789', encryptedOtp), null);
assert.equal(decryptApplicantOtp('09123456789', `${encryptedOtp}tampered`), null);
assert.notEqual(applicantSubjectHash('PHONE', '09123456789'), applicantSubjectHash('IP', '09123456789'));

const now = new Date('2026-08-24T08:00:00.000Z');
const olderCiphertext = encryptApplicantOtp('09123456789', '111111');
const newestCiphertext = encryptApplicantOtp('09123456789', '222222');
const invitations = [
  {
    id: 'older', mobileSnapshot: '09123456789', otpCiphertext: olderCiphertext,
    createdAt: new Date('2026-08-24T06:00:00.000Z'), expiresAt: new Date('2026-08-25T06:00:00.000Z'),
    revokedAt: null, overlapExpiresAt: new Date('2026-08-24T08:30:00.000Z'),
  },
  {
    id: 'newest', mobileSnapshot: '09123456789', otpCiphertext: newestCiphertext,
    createdAt: new Date('2026-08-24T07:00:00.000Z'), expiresAt: new Date('2026-08-25T07:00:00.000Z'),
    revokedAt: null, overlapExpiresAt: null,
  },
];
assert.deepEqual(projectCurrentApplicantOtp(invitations, '09123456789', now), {
  invitationId: 'newest',
  code: '222222',
  expiresAt: new Date('2026-08-25T07:00:00.000Z'),
});
assert.equal(projectCurrentApplicantOtp([{ ...invitations[1], revokedAt: now }], '09123456789', now), null);
assert.equal(projectCurrentApplicantOtp([{ ...invitations[1], expiresAt: now }], '09123456789', now), null);
assert.equal(projectCurrentApplicantOtp([{ ...invitations[1], otpCiphertext: null }], '09123456789', now), null);

for (let index = 0; index < 100; index += 1) assert.match(generateApplicantOtp(), /^\d{6}$/);

console.log('HR candidate access tests passed.');
