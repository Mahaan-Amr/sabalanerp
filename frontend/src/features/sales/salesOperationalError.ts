type SalesOperationalErrorOptions = {
  failedAction: string;
  nextStep: string;
  preserveInput?: boolean;
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
  /(?:پشتیبانی|تماس بگیرید|stack|traceback|prisma|typeerror|referenceerror|validation failed|server error|internal[_ -]?failure|error loading)/i;

const asSentence = (value: string): string => {
  const normalized = value.trim().replace(/[؛،,.!?؟]+$/, '');
  return normalized ? `${normalized}.` : '';
};

const safeTrackingId = (value: unknown): string =>
  typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(value.trim())
    ? value.trim()
    : '';

const safeBusinessMessage = (payload: ErrorPayload): string => {
  const candidates = [payload.error, payload.message]
    .filter((value): value is string => typeof value === 'string');
  return candidates.find((value) =>
    PERSIAN_TEXT.test(value) && !TECHNICAL_OR_DEFLECTING_TEXT.test(value)
  ) || '';
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
  if (!field || !PERSIAN_TEXT.test(rawMessage) || TECHNICAL_OR_DEFLECTING_TEXT.test(rawMessage)) return mapped;
  if (!mapped[field]) mapped[field] = rawMessage;
  return mapped;
}, {});

export const getSalesOperationalErrorMessage = (
  error: unknown,
  options: SalesOperationalErrorOptions,
): string => {
  const response = (error as { response?: { status?: unknown; data?: ErrorPayload } })?.response;
  const status = Number(response?.status || 0);
  const payload = response?.data || {};
  const businessMessage = status > 0 && status < 500
    ? safeBusinessMessage(payload)
    : '';
  const failure = businessMessage
    ? asSentence(businessMessage)
    : status === 0
      ? asSentence(`${options.failedAction} انجام نشد چون ارتباط با سامانه برقرار نشد`)
      : asSentence(`${options.failedAction} انجام نشد`);
  const preserve = options.preserveInput
    ? 'اطلاعات واردشده حفظ شده است.'
    : '';
  const nextStep = failure.includes(options.nextStep.trim())
    ? ''
    : asSentence(options.nextStep);
  const trackingId = safeTrackingId(payload.trackingId);
  const tracking = trackingId ? `کد پیگیری: ${trackingId}` : '';

  return [failure, preserve, nextStep, tracking].filter(Boolean).join(' ');
};
