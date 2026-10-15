import { z } from 'zod';
import { IdSchema, RevisionRef, RevisionRefSchema } from './primitives';

export const ERROR_CATALOG = {
  NOT_FOUND: [404, 'مورد پیدا نشد؛ به فهرست برگردید و مورد دیگری را انتخاب کنید.'],
  FORBIDDEN: [403, 'اجازه انجام این اقدام را ندارید؛ با حساب دارای دسترسی وارد شوید یا به صفحه قبل برگردید.'],
  EDIT_SESSION_OWNED_ELSEWHERE: [409, 'این پیش‌نویس در محل دیگری در حال ویرایش است؛ برای ادامه در اینجا، ویرایش قبلی را متوقف کنید.'],
  NOT_ASSIGNED: [403, 'این استعلام به شما واگذار نشده است؛ استعلام دیگری را از فهرست کارهای خود انتخاب کنید.'],
  RESPONDER_UNAVAILABLE: [409, 'برای حساب شما پاسخ‌دهنده قیمت فعال تعیین نشده است؛ تا تعیین پاسخ‌دهنده، ثبت استعلام را متوقف کنید.'],
  INVALID_PAYLOAD: [400, 'اطلاعات ارسالی معتبر نیست؛ فیلدهای مشخص‌شده را اصلاح و دوباره تلاش کنید.'],
  CATALOG_COMPONENT_UNAVAILABLE: [409, 'یکی از اجزای انتخاب‌شده نرخ معتبر ندارد؛ آن را اصلاح یا حذف کنید.'],
  OPERATION_MINIMUM_NOT_MET: [409, 'مجموع اجرای یک ابزار یا فرآوری سنگ به حداقل تعیین‌شده نمی‌رسد؛ مقدار عملیات را در تنظیمات محصولات اصلاح کنید یا آن عملیات را حذف کنید و دوباره تلاش کنید.'],
  ROW_STALE: [409, 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.'],
  INTEGRITY_CONFLICT: [409, 'شواهد پرونده با نسخه فعلی سازگار نیست؛ صفحه را تازه کنید و دوباره اقدام کنید.'],
  TEMPORARY_FAILURE: [503, 'عملیات موقتاً انجام نشد؛ کمی بعد دوباره تلاش کنید.'],
  INTERNAL_ERROR: [500, 'عملیات انجام نشد؛ کمی بعد دوباره تلاش کنید.'],
  PARTNER_NOT_ACTIVE: [409, 'حساب فروشنده همکار فعال نیست؛ ابتدا آن را در مدیریت همکاران فعال کنید.'],
  APPROVAL_EXPIRED: [409, 'اعتبار قیمت پایان یافته است؛ دوباره استعلام بگیرید.'],
  APPROVAL_SUPERSEDED: [409, 'قیمت جدید جایگزین شده است؛ اطلاعات را تازه کنید.'],
  CONFIG_MISMATCH: [409, 'مشخصات محصول با قیمت تأییدشده مطابقت ندارد؛ مشخصات محصول یا قیمت تأییدشده را دوباره انتخاب کنید.'],
  CUSTOMER_OUT_OF_SCOPE: [404, 'مورد پیدا نشد؛ به فهرست برگردید و مورد دیگری را انتخاب کنید.'],
  IDEMPOTENCY_CONFLICT: [409, 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است؛ صفحه را تازه کنید و درخواست ثبت‌شده را ادامه دهید.'],
  STATE_CONFLICT: [409, 'وضعیت فعلی اجازه این اقدام را نمی‌دهد؛ صفحه را تازه کنید و اقدام متناسب با وضعیت جدید را انتخاب کنید.'],
  INQUIRY_CASE_CANCELLED: [409, 'این قرارداد لغو شده و امکان پاسخ به استعلام وجود ندارد؛ به فهرست استعلام‌ها برگردید.'],
  DEPENDENCY_BLOCKED: [409, 'ابتدا موارد وابسته را تعیین تکلیف کنید.'],
  OPERATIONAL_PAUSE: [409, 'عملیات موقتاً متوقف شده است؛ پس از فعال‌شدن دوباره عملیات، صفحه را تازه کنید.'],
  COHORT_NOT_READY: [409, 'امکان شروع فروش هنوز فعال نشده است؛ پس از فعال‌شدن دسترسی فروش، دوباره تلاش کنید.'],
} as const;
export type PartnerErrorCode = keyof typeof ERROR_CATALOG;
const componentSchema = z.object({ kind: z.enum(['PRODUCT', 'TOOL', 'FINISHING', 'LAYER', 'SERVICE']),
  title: z.string().trim().min(1).max(160), reason: z.enum(['MISSING', 'INACTIVE', 'RATE', 'UNIT']) }).strict();
export type PartnerErrorComponent = z.infer<typeof componentSchema>;
export type PartnerError = { code: PartnerErrorCode; status: 400 | 403 | 404 | 409 | 500 | 503; message: string;
  component?: PartnerErrorComponent };
export function partnerError(code: PartnerErrorCode, component?: PartnerErrorComponent): PartnerError {
  const [status, message] = ERROR_CATALOG[code];
  if (code === 'CATALOG_COMPONENT_UNAVAILABLE' && component) {
    const safe = componentSchema.parse(component);
    const kind = { PRODUCT: 'محصول', TOOL: 'ابزار', FINISHING: 'پرداخت سنگ', LAYER: 'نوع لایه', SERVICE: 'خدمت' }[safe.kind];
    const reason = { MISSING: 'در کاتالوگ موجود نیست', INACTIVE: 'غیرفعال است', RATE: 'نرخ معتبر ندارد', UNIT: 'واحد محاسبه آن تغییر کرده است' }[safe.reason];
    return { code, status, component: safe, message: `${kind} «${safe.title}» ${reason}؛ آن را جایگزین یا حذف کنید و دوباره ذخیره کنید.` };
  }
  return { code, status, message };
}
// Internal codes may distinguish causes. HTTP adapters must collapse hidden existence.
export function publicError(error: PartnerError, supportReference: string) {
  const code = Object.prototype.hasOwnProperty.call(ERROR_CATALOG, error.code) ? error.code : 'INVALID_PAYLOAD';
  const canonical = partnerError(code, error.component);
  const safe = canonical.status === 404 ? partnerError('NOT_FOUND') : canonical;
  return { ...safe, supportReference: IdSchema.parse(supportReference) };
}
export const PartnerErrorSchema = z.object({
  code: z.enum(Object.keys(ERROR_CATALOG) as [PartnerErrorCode, ...PartnerErrorCode[]]),
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(500), z.literal(503)]), message: z.string(),
  component: componentSchema.optional(),
}).strict().refine(error => (!error.component || error.code === 'CATALOG_COMPONENT_UNAVAILABLE') &&
  ERROR_CATALOG[error.code][0] === error.status && partnerError(error.code, error.component).message === error.message);
export type Result<T> = { ok: true; value: T } | { ok: false; error: PartnerError };

export function checkExpectedRevision(expected: RevisionRef, actual: RevisionRef): PartnerError | null {
  RevisionRefSchema.parse(expected); RevisionRefSchema.parse(actual);
  if (expected.caseId !== actual.caseId) return partnerError('NOT_FOUND');
  if (expected.revision !== actual.revision) return partnerError('ROW_STALE');
  return expected.integrityHash === actual.integrityHash ? null : partnerError('INTEGRITY_CONFLICT');
}
