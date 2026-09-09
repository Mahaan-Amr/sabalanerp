import { z } from 'zod';
import { IdSchema, RevisionRef, RevisionRefSchema } from './primitives';

export const ERROR_CATALOG = {
  NOT_FOUND: [404, 'مورد در دسترس نیست.'],
  FORBIDDEN: [403, 'اجازه انجام این اقدام را ندارید.'],
  NOT_ASSIGNED: [403, 'پاسخ این استعلام به شما واگذار نشده است.'],
  RESPONDER_UNAVAILABLE: [409, 'برای حساب شما پاسخ‌دهنده قیمت فعال تعیین نشده است.'],
  INVALID_PAYLOAD: [400, 'اطلاعات ارسالی معتبر نیست.'],
  ROW_STALE: [409, 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.'],
  INTEGRITY_CONFLICT: [409, 'شواهد پرونده نیازمند بررسی پشتیبانی است.'],
  PARTNER_NOT_ACTIVE: [409, 'حساب فروشنده همکار فعال نیست.'],
  APPROVAL_EXPIRED: [409, 'اعتبار قیمت پایان یافته است؛ دوباره استعلام بگیرید.'],
  APPROVAL_SUPERSEDED: [409, 'قیمت جدید جایگزین شده است؛ اطلاعات را تازه کنید.'],
  CONFIG_MISMATCH: [409, 'مشخصات محصول با قیمت تأییدشده مطابقت ندارد.'],
  CUSTOMER_OUT_OF_SCOPE: [404, 'مورد در دسترس نیست.'],
  IDEMPOTENCY_CONFLICT: [409, 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است.'],
  STATE_CONFLICT: [409, 'وضعیت فعلی اجازه این اقدام را نمی‌دهد.'],
  DEPENDENCY_BLOCKED: [409, 'ابتدا موارد وابسته را تعیین تکلیف کنید.'],
  OPERATIONAL_PAUSE: [409, 'عملیات موقتاً متوقف شده است.'],
  COHORT_NOT_READY: [409, 'امکان شروع فروش هنوز فعال نشده است.'],
} as const;
export type PartnerErrorCode = keyof typeof ERROR_CATALOG;
export type PartnerError = { code: PartnerErrorCode; status: 400 | 403 | 404 | 409; message: string };
export function partnerError(code: PartnerErrorCode): PartnerError {
  const [status, message] = ERROR_CATALOG[code];
  return { code, status, message };
}
// Internal codes may distinguish causes. HTTP adapters must collapse hidden existence.
export function publicError(error: PartnerError, supportReference: string) {
  const code = Object.prototype.hasOwnProperty.call(ERROR_CATALOG, error.code) ? error.code : 'INVALID_PAYLOAD';
  const canonical = partnerError(code);
  const safe = canonical.status === 404 ? partnerError('NOT_FOUND') : canonical;
  return { ...safe, supportReference: IdSchema.parse(supportReference) };
}
export const PartnerErrorSchema = z.object({
  code: z.enum(Object.keys(ERROR_CATALOG) as [PartnerErrorCode, ...PartnerErrorCode[]]),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409)]), message: z.string(),
}).strict().refine(error => ERROR_CATALOG[error.code][0] === error.status && ERROR_CATALOG[error.code][1] === error.message);
export type Result<T> = { ok: true; value: T } | { ok: false; error: PartnerError };

export function checkExpectedRevision(expected: RevisionRef, actual: RevisionRef): PartnerError | null {
  RevisionRefSchema.parse(expected); RevisionRefSchema.parse(actual);
  if (expected.caseId !== actual.caseId) return partnerError('NOT_FOUND');
  if (expected.revision !== actual.revision) return partnerError('ROW_STALE');
  return expected.integrityHash === actual.integrityHash ? null : partnerError('INTEGRITY_CONFLICT');
}
