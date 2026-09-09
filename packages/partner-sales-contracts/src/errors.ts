import { z } from 'zod';
import { IdSchema, RevisionRef, RevisionRefSchema } from './primitives';

export const ERROR_CATALOG = {
  NOT_FOUND: [404, 'مورد در دسترس نیست؛ به فهرست برگردید و مورد دیگری را انتخاب کنید.'],
  FORBIDDEN: [403, 'اجازه انجام این اقدام را ندارید؛ به صفحه قبل برگردید.'],
  NOT_ASSIGNED: [403, 'پاسخ این استعلام به شما واگذار نشده است؛ صف استعلام‌ها را تازه‌سازی کنید.'],
  RESPONDER_UNAVAILABLE: [409, 'برای این حساب پاسخ‌دهنده قیمت فعال تعیین نشده است؛ در مدیریت فروشندگان همکار یک پاسخ‌دهنده فعال انتخاب کنید.'],
  INVALID_PAYLOAD: [400, 'اطلاعات ارسالی معتبر نیست؛ فیلدهای مشخص‌شده را اصلاح کنید.'],
  ROW_STALE: [409, 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.'],
  INTEGRITY_CONFLICT: [409, 'شواهد پرونده با نسخه فعلی هم‌خوان نیست؛ وضعیت پرونده را تازه‌سازی کنید.'],
  PARTNER_NOT_ACTIVE: [409, 'حساب فروشنده همکار فعال نیست؛ ابتدا وضعیت حساب را در مدیریت فروشندگان همکار بررسی کنید.'],
  APPROVAL_EXPIRED: [409, 'اعتبار قیمت پایان یافته است؛ دوباره استعلام بگیرید.'],
  APPROVAL_SUPERSEDED: [409, 'قیمت جدید جایگزین شده است؛ اطلاعات را تازه کنید.'],
  CONFIG_MISMATCH: [409, 'مشخصات محصول با قیمت تأییدشده مطابقت ندارد؛ مشخصات را به قیمت تأییدشده برگردانید یا استعلام تازه بگیرید.'],
  CUSTOMER_OUT_OF_SCOPE: [404, 'مشتری در محدوده کاری شما نیست؛ به فهرست مشتریان مجاز برگردید.'],
  IDEMPOTENCY_CONFLICT: [409, 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است؛ وضعیت پرونده را تازه‌سازی و درخواست ثبت‌شده را بررسی کنید.'],
  STATE_CONFLICT: [409, 'وضعیت فعلی اجازه این اقدام را نمی‌دهد؛ وضعیت پرونده را تازه‌سازی کنید.'],
  DEPENDENCY_BLOCKED: [409, 'موارد وابسته هنوز تعیین تکلیف نشده‌اند؛ ابتدا موارد نمایش‌داده‌شده را کامل کنید.'],
  OPERATIONAL_PAUSE: [409, 'عملیات موقتاً متوقف شده است؛ وضعیت عملیات را تازه‌سازی و پس از پایان توقف دوباره اقدام کنید.'],
  COHORT_NOT_READY: [409, 'شروع فروش هنوز فعال نشده است؛ وضعیت حساب را در مدیریت فروشندگان همکار بررسی کنید.'],
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
