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

const otpEncryptionKey = () =>
  crypto.createHash('sha256').update(`HR_APPLICANT_OTP_ENCRYPTION:${accessSecret()}`).digest();

export const applicantOtpHash = (mobile: string, otp: string): string =>
  crypto.createHmac('sha256', accessSecret()).update(`HR_APPLICANT_OTP:${mobile}:${otp}`).digest('hex');

export const encryptApplicantOtp = (mobile: string, otp: string): string => {
  const normalizedOtp = normalizeApplicantOtp(otp);
  if (!normalizedOtp) throw new Error('Applicant OTP must contain exactly six digits.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', otpEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(mobile, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(normalizedOtp, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptApplicantOtp = (mobile: string, ciphertext: unknown): string | null => {
  try {
    const [version, ivValue, tagValue, encryptedValue] = String(ciphertext || '').split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) return null;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      otpEncryptionKey(),
      Buffer.from(ivValue, 'base64url')
    );
    decipher.setAAD(Buffer.from(mobile, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
    return normalizeApplicantOtp(decrypted);
  } catch {
    return null;
  }
};

type ApplicantInvitationForOtpProjection = {
  id: string;
  mobileSnapshot: string;
  otpCiphertext: unknown;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  overlapExpiresAt: Date | null;
};

export const projectCurrentApplicantOtp = (
  invitations: ApplicantInvitationForOtpProjection[],
  mobile: string,
  now = new Date(),
): { invitationId: string; code: string; expiresAt: Date } | null => {
  const current = invitations
    .filter((invitation) =>
      invitation.mobileSnapshot === mobile
      && !invitation.revokedAt
      && invitation.expiresAt > now
      && (!invitation.overlapExpiresAt || invitation.overlapExpiresAt > now))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  if (!current) return null;
  const code = decryptApplicantOtp(mobile, current.otpCiphertext);
  return code ? { invitationId: current.id, code, expiresAt: current.expiresAt } : null;
};

export const applicantSubjectHash = (kind: 'PHONE' | 'IP', value: string): string =>
  crypto.createHmac('sha256', accessSecret()).update(`HR_APPLICANT_${kind}:${value}`).digest('hex');

export const generateApplicantOtp = (): string => String(crypto.randomInt(100000, 1000000));
