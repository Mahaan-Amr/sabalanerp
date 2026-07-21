import crypto from 'crypto';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const normalizeApplicantDigits = (value: unknown): string =>
  String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/\D/g, '');

export const normalizeApplicantMobile = (value: unknown): string | null => {
  const digits = normalizeApplicantDigits(value);
  const normalized = digits.startsWith('0098')
    ? `0${digits.slice(4)}`
    : digits.startsWith('98') && digits.length === 12
      ? `0${digits.slice(2)}`
      : digits.startsWith('9') && digits.length === 10
        ? `0${digits}`
        : digits;

  return /^09\d{9}$/.test(normalized) ? normalized : null;
};

export const normalizeApplicantOtp = (value: unknown): string | null => {
  const digits = normalizeApplicantDigits(value);
  return /^\d{6}$/.test(digits) ? digits : null;
};

const accessSecret = () => process.env.JWT_SECRET || 'development-secret';

export const applicantOtpHash = (mobile: string, otp: string): string =>
  crypto.createHmac('sha256', accessSecret()).update(`HR_APPLICANT_OTP:${mobile}:${otp}`).digest('hex');

export const applicantSubjectHash = (kind: 'PHONE' | 'IP', value: string): string =>
  crypto.createHmac('sha256', accessSecret()).update(`HR_APPLICANT_${kind}:${value}`).digest('hex');

export const generateApplicantOtp = (): string => String(crypto.randomInt(100000, 1000000));
