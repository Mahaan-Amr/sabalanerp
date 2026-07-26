// Stair validation service
// Handles all stair system V2 validation logic

import type {
  StairStepperPart,
  StairPartDraftV2,
  StairDraftFieldErrors,
  LayerTypeOption
} from '../types/contract.types';
import {
  getActualLengthMeters,
  getDraftStandardLengthMeters,
  getPartDisplayLabel
} from '../utils/stairUtils';
import { formatDisplayNumber } from '../utils/formatUtils';

/**
 * Validate numeric fields for stair draft
 */
export const validateDraftNumericFields = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  field: keyof StairDraftFieldErrors,
  value: number | null,
  layerTypes: LayerTypeOption[] = []
): string | null => {
  const partLabel = getPartDisplayLabel(part);
  const product = draft.stoneProduct;
  
  if (!product) {
    return null; // Product selection validation is handled separately
  }

  const originalWidthCm = product.widthValue || 0;
  const originalThicknessCm = product.thicknessValue || 0;

  switch (field) {
    case 'length': {
      if (value === null || value === undefined || value <= 0) {
        return `طول برای ${partLabel} الزامی است`;
      }
      if (value > 1000) { // Reasonable max: 10 meters or 1000 cm
        const unit = draft.lengthUnit || 'm';
        const maxValue = unit === 'm' ? 10 : 1000;
        return `طول نمی‌تواند بیشتر از ${maxValue} ${unit === 'm' ? 'متر' : 'سانتی‌متر'} باشد`;
      }
      return null;
    }

    case 'motherLength': {
      if (value === null || value === undefined || value <= 0) {
        return null;
      }
      const motherLength = getDraftStandardLengthMeters(draft);
      const finishedLength = getActualLengthMeters(draft);
      if (motherLength > 0 && finishedLength > motherLength + 0.000001) {
        return 'طول مادر باید حداقل برابر طول نهایی باشد';
      }
      return null;
    }

    case 'width':
      if (value === null || value === undefined) {
        return `عرض برای ${partLabel} الزامی است`;
      }
      if (value <= 0) {
        return `عرض باید بزرگ‌تر از صفر باشد`;
      }
      if (originalWidthCm > 0 && value > originalWidthCm) {
        return `عرض وارد شده (${formatDisplayNumber(value)}cm) نمی‌تواند بیشتر از عرض سنگ (${formatDisplayNumber(originalWidthCm)}cm) باشد`;
      }
      if (value < 1) {
        return `عرض باید حداقل 1 سانتی‌متر باشد`;
      }
      return null;

    case 'quantity':
      if (value === null || value === undefined) {
        return `تعداد برای ${partLabel} الزامی است`;
      }
      if (value <= 0) {
        return `تعداد باید بزرگ‌تر از صفر باشد`;
      }
      if (!Number.isInteger(value)) {
        return `تعداد باید عدد صحیح باشد`;
      }
      if (value > 10000) {
        return `تعداد نمی‌تواند بیشتر از 10,000 باشد`;
      }
      return null;

    case 'pricePerSquareMeter':
      if (value === null || value === undefined) {
        return `قیمت هر متر مربع برای ${partLabel} الزامی است`;
      }
      if (value <= 0) {
        return `قیمت هر متر مربع باید بزرگ‌تر از صفر باشد`;
      }
      if (value > 100000000) { // Reasonable max: 100 million Toman per sqm
        return `قیمت هر متر مربع نمی‌تواند بیشتر از 100,000,000 تومان باشد`;
      }
      return null;

    case 'layerStonePrice':
      if (value === null || value === undefined) {
        return 'قیمت سنگ لایه الزامی است';
      }
      if (value <= 0) {
        return 'قیمت سنگ لایه باید بزرگ‌تر از صفر باشد';
      }
      if (value > 100000000) {
        return 'قیمت سنگ لایه نمی‌تواند بیشتر از 100,000,000 تومان باشد';
      }
      return null;

    case 'layerMandatoryPercentage':
      if (value === null || value === undefined) {
        return 'درصد حکمی لایه الزامی است';
      }
      if (value < 0) {
        return 'درصد حکمی نباید کمتر از 0 باشد';
      }
      if (value > 100) {
        return 'درصد حکمی نباید بیشتر از 100 باشد';
      }
      return null;

    case 'mandatoryPercentage':
      if (value === null || value === undefined) {
        return `درصد حکمی ${partLabel} الزامی است`;
      }
      if (value < 0) {
        return 'درصد حکمی نباید کمتر از 0 باشد';
      }
      if (value > 100) {
        return 'درصد حکمی نباید بیشتر از 100 باشد';
      }
      return null;

    case 'thickness':
      // Thickness is auto-set from product, but validate it matches
      if (originalThicknessCm > 0) {
        const currentThickness = draft.thicknessCm ?? 0;
        if (Math.abs(currentThickness - originalThicknessCm) > 0.01) {
          return `ضخامت باید با ضخامت محصول (${formatDisplayNumber(originalThicknessCm)}cm) برابر باشد`;
        }
      }
      return null;

    default:
      return null;
  }
};

/**
 * Validate all required fields for stair draft
 */
export const validateDraftRequiredFields = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  layerTypes: LayerTypeOption[] = []
): StairDraftFieldErrors => {
  const partLabel = getPartDisplayLabel(part);
  const errors: StairDraftFieldErrors = {};

  if (!draft.stoneId || !draft.stoneProduct) {
    errors.thickness = `انتخاب سنگ برای ${partLabel} الزامی است`;
    return errors; // Can't validate other fields without product
  }

  // Validate each field using the comprehensive validation function
  const lengthError = validateDraftNumericFields(part, draft, 'length', draft.lengthValue ?? null, layerTypes);
  if (lengthError) errors.length = lengthError;

  const motherLengthError = validateDraftNumericFields(
    part,
    draft,
    'motherLength',
    draft.standardLengthValue ?? null,
    layerTypes
  );
  if (motherLengthError) errors.motherLength = motherLengthError;

  const widthError = validateDraftNumericFields(part, draft, 'width', draft.widthCm ?? null, layerTypes);
  if (widthError) errors.width = widthError;

  const quantityError = validateDraftNumericFields(part, draft, 'quantity', draft.quantity ?? null, layerTypes);
  if (quantityError) errors.quantity = quantityError;

  const priceError = validateDraftNumericFields(part, draft, 'pricePerSquareMeter', draft.pricePerSquareMeter ?? null, layerTypes);
  if (priceError) errors.pricePerSquareMeter = priceError;

  const thicknessError = validateDraftNumericFields(part, draft, 'thickness', draft.thicknessCm ?? null, layerTypes);
  if (thicknessError) errors.thickness = thicknessError;

  const mandatoryDefault = part === 'riser' || part === 'landing';
  const shouldValidateMandatory = draft.useMandatory ?? mandatoryDefault;
  if (shouldValidateMandatory) {
    const mandatoryError = validateDraftNumericFields(part, draft, 'mandatoryPercentage', draft.mandatoryPercentage ?? 20, layerTypes);
    if (mandatoryError) {
      errors.mandatoryPercentage = mandatoryError;
    }
  }

  const hasLayerConfiguration =
    Boolean(draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0);

  if (hasLayerConfiguration && !draft.layerTypeId) {
    errors.layerType = 'انتخاب نوع لایه الزامی است';
  } else if (hasLayerConfiguration && !(Number(draft.layerTypePrice) > 0)) {
    errors.layerType = 'قیمت نوع لایه در انبار معتبر نیست';
  }

  if (hasLayerConfiguration && !draft.layerSourceKind) {
    errors.layerSource = 'منبع سنگ لایه را انتخاب کنید';
  }

  if (hasLayerConfiguration && draft.layerRemovedSideConflicts?.length) {
    errors.layerSource = 'عملیات سمت حذف‌شده را تعیین تکلیف کنید';
  }

  if (
    hasLayerConfiguration &&
    draft.layerSourceKind === 'contractRemainder' &&
    !(draft.layerSelectedRemainingStoneIds?.length)
  ) {
    errors.layerSource = 'باقی‌مانده موردنظر را انتخاب کنید';
  }

  if (hasLayerConfiguration && draft.layerSourceKind === 'newMaterial') {
    if (!draft.layerStoneProduct || !draft.layerStoneProductId) {
      errors.layerStone = 'انتخاب سنگ لایه الزامی است';
    }
    const layerPriceError = validateDraftNumericFields(part, draft, 'layerStonePrice', draft.layerPricePerSquareMeter ?? null, layerTypes);
    if (layerPriceError) {
      errors.layerStonePrice = layerPriceError;
    }
    if (draft.layerUseMandatory !== false) {
      const mandatoryError = validateDraftNumericFields(part, draft, 'layerMandatoryPercentage', draft.layerMandatoryPercentage ?? null, layerTypes);
      if (mandatoryError) {
        errors.layerMandatoryPercentage = mandatoryError;
      }
    }
  }

  return errors;
};

/**
 * Clear a specific field error from draft errors
 * This is a helper function that returns a new errors object with the field cleared
 */
export const clearDraftFieldError = (
  currentErrors: StairDraftFieldErrors,
  field: keyof StairDraftFieldErrors
): StairDraftFieldErrors => {
  const updated = { ...currentErrors };
  delete updated[field];
  return updated;
};


