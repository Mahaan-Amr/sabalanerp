import { addTehranWorkingDays } from './tehranBusinessCalendar';

export const COMPENSATION_RETURN_REASON_CODES = [
  'AMOUNT_INCORRECT',
  'CATEGORY_INCORRECT',
  'POLICY_MISMATCH',
  'INCOMPLETE_INFORMATION',
] as const;

export type CompensationReturnReasonCode = typeof COMPENSATION_RETURN_REASON_CODES[number];

type CompensationReviewEvidence = {
  payrollReviewStatus?: string | null;
  payrollVerifiedAt?: Date | string | null;
  hrApprovedAt?: Date | string | null;
  financeApprovedAt?: Date | string | null;
};

export const isCompensationPayrollVerified = (snapshot: CompensationReviewEvidence | null | undefined) => {
  if (!snapshot) return false;
  if (snapshot.payrollReviewStatus === 'RETURNED') return false;
  if (snapshot.payrollReviewStatus === 'VERIFIED') return true;
  return Boolean(snapshot.payrollVerifiedAt || (snapshot.hrApprovedAt && snapshot.financeApprovedAt));
};

export const compensationVerificationDueAt = (proposedAt: Date, holidays: ReadonlySet<string> = new Set()) => addTehranWorkingDays(proposedAt, 3, holidays);

export const normalizeCompensationReturnReason = (input: { code: unknown; detail: unknown }) => {
  const code = String(input.code || '') as CompensationReturnReasonCode;
  if (!COMPENSATION_RETURN_REASON_CODES.includes(code)) throw new Error('دسته بازگشت پیشنهاد حقوق معتبر نیست.');
  const detail = String(input.detail || '').trim();
  if (detail.length < 3) throw new Error('توضیح بازگشت پیشنهاد حقوق الزامی است.');
  return { code, detail };
};
