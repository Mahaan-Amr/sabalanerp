type SalesOperationalErrorOptions = {
  failedAction: string;
  nextStep: string;
  preserveInput?: boolean;
  uncertainMutation?: boolean;
};

type ErrorPayload = {
  error?: unknown;
  message?: unknown;
  trackingId?: unknown;
};

type ValidationDetail = {
  path?: unknown;
  param?: unknown;
  field?: unknown;
  msg?: unknown;
  message?: unknown;
};

const PERSIAN_TEXT = /[\u0600-\u06ff]/;
const TECHNICAL_OR_DEFLECTING_TEXT =
  /(?:پشتیبانی|تماس بگیرید|stack|traceback|prisma|typeerror|referenceerror|validation failed|server error|internal[_ -]?failure|error loading|exception|constraint|database|sql|select\s|insert\s|update\s|delete\s|\bat\s+\w|\/api\/|[{}[\]<>]|\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b)/i;
const SAFE_LATIN_TERMS = new Set(['PDF', 'CRM', 'CNC', 'OTP', 'SMS', 'Excel']);

const asSentence = (value: string): string => {
  const normalized = value.trim().replace(/[؛،,.!?؟]+$/, '');
  return normalized ? `${normalized}.` : '';
};

const safeTrackingId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(value.trim())
    ? value.trim()
    : '';

const isSafeBusinessText = (value: string): boolean => {
  const latinTerms = value.match(/[A-Za-z][A-Za-z0-9_.:/-]*/g) || [];
  return value.length <= 500
    && PERSIAN_TEXT.test(value)
    && !TECHNICAL_OR_DEFLECTING_TEXT.test(value)
    && latinTerms.every((term) => SAFE_LATIN_TERMS.has(term));
};

const safeBusinessMessage = (payload: ErrorPayload): string => {
  const candidates = [payload.error, payload.message]
    .filter((value): value is string => typeof value === 'string');
  return candidates.find(isSafeBusinessText) || '';
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

const PRODUCT_CREATION_FIELD_ALIASES: Record<string, string> = {
  code: 'cutType',
  name: 'cutType',
  namePersian: 'cutType',
  cuttingDimensionCode: 'cutType',
  cuttingDimensionName: 'cutType',
  cuttingDimensionNamePersian: 'cutType',
  stoneTypeCode: 'stoneMaterial',
  stoneTypeName: 'stoneMaterial',
  stoneTypeNamePersian: 'stoneMaterial',
  widthCode: 'cutWidth',
  widthValue: 'cutWidth',
  widthName: 'cutWidth',
  motherLengthValue: 'motherLengthValue',
  thicknessCode: 'thickness',
  thicknessValue: 'thickness',
  thicknessName: 'thickness',
  mineCode: 'mine',
  mineName: 'mine',
  mineNamePersian: 'mine',
  finishCode: 'finishType',
  finishName: 'finishType',
  finishNamePersian: 'finishType',
  colorCode: 'color',
  colorName: 'color',
  colorNamePersian: 'color',
  availableInLongitudinalContracts: 'contractVisibility',
  availableInStairContracts: 'contractVisibility',
  availableInSlabContracts: 'contractVisibility',
  availableInVolumetricContracts: 'contractVisibility',
};

export const mapProductCreationValidationErrors = (
  details: ValidationDetail[],
): Record<string, string> => details.reduce<Record<string, string>>((mapped, detail) => {
  const rawPath = detail.path || detail.param || detail.field;
  const rawMessage = detail.msg || detail.message;
  if (typeof rawPath !== 'string' || typeof rawMessage !== 'string') return mapped;
  const field = PRODUCT_CREATION_FIELD_ALIASES[rawPath];
  if (!field || !isSafeBusinessText(rawMessage)) return mapped;
  if (!mapped[field]) mapped[field] = rawMessage;
  return mapped;
}, {});

const PRODUCT_EDIT_FIELDS = new Set([
  'basePrice', 'motherLengthValue', 'isAvailable', 'leadTime', 'description', 'images',
]);

export const mapProductEditValidationErrors = (
  details: ValidationDetail[],
): Record<string, string> => details.reduce<Record<string, string>>((mapped, detail) => {
  const rawPath = detail.path || detail.param || detail.field;
  const rawMessage = detail.msg || detail.message;
  if (typeof rawPath !== 'string' || typeof rawMessage !== 'string') return mapped;
  if (!PRODUCT_EDIT_FIELDS.has(rawPath) || !isSafeBusinessText(rawMessage)) return mapped;
  if (!mapped[rawPath]) mapped[rawPath] = rawMessage;
  return mapped;
}, {});

export const getSalesOperationalErrorMessage = (
  error: unknown,
  options: SalesOperationalErrorOptions,
): string => {
  const response = (error as { response?: { status?: unknown; data?: ErrorPayload } })?.response;
  const status = Number(response?.status || 0);
  const payload = response?.data || {};
  const requestTrackingId = (error as { config?: { headers?: { get?: (name: string) => unknown; [key: string]: unknown } } })
    ?.config?.headers?.get?.('x-correlation-id')
    || (error as { config?: { headers?: Record<string, unknown> } })?.config?.headers?.['x-correlation-id'];
  const businessMessage = status > 0 && status < 500
    ? safeBusinessMessage(payload)
    : '';
  const failure = businessMessage
    ? asSentence(businessMessage)
    : isNetworkFailure(error)
      ? asSentence(`${options.failedAction} انجام نشد چون ارتباط با سامانه برقرار نشد`)
      : asSentence(`${options.failedAction} انجام نشد`);
  const preserve = options.preserveInput
    ? 'اطلاعات واردشده حفظ شده است.'
    : '';
  const requestedNextStep = options.uncertainMutation && !businessMessage
    ? 'وضعیت فعلی را بررسی کنید؛ فقط اگر عملیات انجام نشده بود دوباره تلاش کنید.'
    : options.nextStep;
  const nextStep = failure.includes(requestedNextStep.trim())
    ? ''
    : asSentence(requestedNextStep);
  const trackingId = safeTrackingId(payload.trackingId)
    || safeTrackingId(requestTrackingId);
  const tracking = trackingId ? `کد پیگیری: ${trackingId}` : '';

  return [failure, preserve, nextStep, tracking].filter(Boolean).join(' ');
};

export const getSalesErrorSummary = (errors: Record<string, string>): string => {
  const count = Object.values(errors).filter((message) => message.trim()).length;
  return count > 1
    ? `${count.toLocaleString('fa-IR')} مورد نیاز به اصلاح است؛ از اولین فیلد مشخص‌شده شروع کنید.`
    : '';
};

export const getSalesOperationalErrorKind = (error: unknown): 'error' | 'permission' | 'stale' => {
  const status = Number((error as { response?: { status?: unknown } })?.response?.status || 0);
  if (status === 401 || status === 403) return 'permission';
  if ([404, 409, 410, 412].includes(status)) return 'stale';
  return 'error';
};
