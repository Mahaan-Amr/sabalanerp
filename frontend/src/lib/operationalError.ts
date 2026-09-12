export type OperationalErrorKind = 'error' | 'permission' | 'stale';

export type OperationalErrorOptions = {
  failedAction: string;
  nextStep: string;
  preserveInput?: boolean;
  uncertainMutation?: boolean;
};

type ErrorPayload = { error?: unknown; message?: unknown; trackingId?: unknown };
type ErrorWithResponse = { response?: { data?: unknown; [key: string]: unknown }; [key: string]: unknown };

const PERSIAN_TEXT = /[\u0600-\u06ff]/;
const TECHNICAL_OR_DEFLECTING_TEXT =
  /(?:پشتیبانی|تماس بگیرید|عملیات(?: فروش)? انجام نشد|خطایی رخ داد|مشکلی پیش آمد|خطا در|stack|traceback|prisma|typeerror|referenceerror|validation failed|server error|internal[_ -]?failure|error loading|exception|constraint|database|sql|select\s|insert\s|update\s|delete\s|\bat\s+\w|\/api\/|[{}[\]<>]|\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b)/i;
const SAFE_LATIN_TERMS = new Set(['PDF', 'CRM', 'CNC', 'OTP', 'SMS', 'Excel']);

const asSentence = (value: string): string => {
  const normalized = value.trim().replace(/[؛،,.!?؟]+$/, '');
  return normalized ? `${normalized}.` : '';
};

const safeTrackingId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(value.trim()) ? value.trim() : '';

export const isSafeOperationalBusinessText = (value: string): boolean => {
  const latinTerms = value.match(/[A-Za-z][A-Za-z0-9_.:/-]*/g) || [];
  return value.length <= 500
    && PERSIAN_TEXT.test(value)
    && !TECHNICAL_OR_DEFLECTING_TEXT.test(value)
    && latinTerms.every((term) => SAFE_LATIN_TERMS.has(term));
};

const safeBusinessMessage = (payload: ErrorPayload): string => {
  const candidates = [payload.error, payload.message]
    .filter((value): value is string => typeof value === 'string');
  return candidates.find(isSafeOperationalBusinessText) || '';
};

export const normalizeBlobOperationalError = async (error: unknown): Promise<unknown> => {
  const candidate = error as ErrorWithResponse;
  const data = candidate?.response?.data;
  if (typeof Blob === 'undefined' || !(data instanceof Blob) || data.size > 100_000) return error;
  try {
    const text = await data.text();
    if (!text.trim()) return error;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
    if (typeof payload === 'string') payload = { error: payload };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return error;
    return { ...candidate, response: { ...candidate.response, data: payload } };
  } catch {
    return error;
  }
};

export const assertSuccessfulOperationalResponse = (
  response: { data?: { success?: unknown } },
): void => {
  if (response?.data?.success !== true) throw { response };
};

export const assertSuccessfulOperationalResult = (
  result: { success?: unknown },
): void => {
  if (result?.success !== true) throw { response: { data: result } };
};

export const assertSuccessfulBlobOperationalResponse = async (
  response: { data?: unknown },
): Promise<void> => {
  const data = response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob && !/json/i.test(data.type)) return;
  const normalized = await normalizeBlobOperationalError({ response }) as { response?: { data?: { success?: unknown } } };
  assertSuccessfulOperationalResponse(normalized.response || response as { data?: { success?: unknown } });
};

const isNetworkFailure = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown; response?: unknown };
  if (candidate?.response) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (typeof candidate?.code === 'string' && ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(candidate.code)) return true;
  return candidate?.name === 'TypeError'
    && typeof candidate.message === 'string'
    && /failed to fetch|network|بارگذاری ناموفق/i.test(candidate.message);
};

export const getOperationalErrorMessage = (error: unknown, options: OperationalErrorOptions): string => {
  const response = (error as { response?: { status?: unknown; data?: ErrorPayload } })?.response;
  const status = Number(response?.status || 0);
  const payload = response?.data || {};
  const requestTrackingId = (error as { config?: { headers?: { get?: (name: string) => unknown; [key: string]: unknown } } })
    ?.config?.headers?.get?.('x-correlation-id')
    || (error as { config?: { headers?: Record<string, unknown> } })?.config?.headers?.['x-correlation-id'];
  // The same strict allow-list protects all response classes, including 5xx bodies.
  const businessMessage = safeBusinessMessage(payload);
  const failure = businessMessage
    ? asSentence(businessMessage)
    : isNetworkFailure(error)
      ? asSentence(`${options.failedAction} انجام نشد چون ارتباط با سامانه برقرار نشد`)
      : response
        ? asSentence(`${options.failedAction} انجام نشد چون پاسخ قابل‌استفاده‌ای از سامانه دریافت نشد`)
        : asSentence(`${options.failedAction} انجام نشد چون نتیجه قابل‌اعتمادی دریافت نشد`);
  const preserve = options.preserveInput ? 'اطلاعات واردشده حفظ شده است.' : '';
  const requestedNextStep = options.uncertainMutation && (!businessMessage || status >= 500) && !options.nextStep.includes('فقط اگر')
    ? 'وضعیت فعلی را بررسی کنید؛ فقط اگر عملیات انجام نشده بود دوباره تلاش کنید.'
    : options.nextStep;
  const nextStep = failure.includes(requestedNextStep.trim()) ? '' : asSentence(requestedNextStep);
  const trackingId = safeTrackingId(payload.trackingId) || safeTrackingId(requestTrackingId);
  const tracking = trackingId ? `کد پیگیری: ${trackingId}` : '';
  return [failure, preserve, nextStep, tracking].filter(Boolean).join(' ');
};

export const getOperationalErrorKind = (error: unknown): OperationalErrorKind => {
  const status = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
  if (status === 401 || status === 403) return 'permission';
  if ([404, 409, 410, 412].includes(status)) return 'stale';
  return 'error';
};
