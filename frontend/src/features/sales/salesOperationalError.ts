import {
  assertSuccessfulOperationalResponse,
  getOperationalErrorKind,
  getOperationalErrorMessage,
  isSafeOperationalBusinessText,
  normalizeBlobOperationalError,
} from '@/lib/operationalError';

export const getSalesOperationalErrorMessage = getOperationalErrorMessage;
export const getSalesOperationalErrorKind = getOperationalErrorKind;
export const normalizeSalesBlobError = normalizeBlobOperationalError;
export const assertSuccessfulSalesResponse = assertSuccessfulOperationalResponse;

type ValidationDetail = {
  path?: unknown;
  param?: unknown;
  field?: unknown;
  msg?: unknown;
  message?: unknown;
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
  if (!field || !isSafeOperationalBusinessText(rawMessage)) return mapped;
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
  if (!PRODUCT_EDIT_FIELDS.has(rawPath) || !isSafeOperationalBusinessText(rawMessage)) return mapped;
  if (!mapped[rawPath]) mapped[rawPath] = rawMessage;
  return mapped;
}, {});

export const getSalesErrorSummary = (errors: Record<string, string>): string => {
  const count = Object.values(errors).filter((message) => message.trim()).length;
  return count > 1
    ? `${count.toLocaleString('fa-IR')} مورد نیاز به اصلاح است؛ از اولین فیلد مشخص‌شده شروع کنید.`
    : '';
};
