// Stair validation service
// Handles all stair system V2 validation logic

import type {
  StairStepperPart,
  StairPartDraftV2,
  StairDraftFieldErrors,
  LayerTypeOption
} from '../types/contract.types';
import { getPartDisplayLabel, getDraftStandardLengthMeters } from '../utils/stairUtils';
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
      const hasStandardLength = getDraftStandardLengthMeters(draft) > 0;
      if (value === null || value === undefined || value <= 0) {
        if (!hasStandardLength) {
          return `لطفاً طول را برای ${partLabel} وارد کنید`;
        }
        return null;
      }
      if (value > 1000) { // Reasonable max: 10 meters or 1000 cm
        const unit = draft.lengthUnit || 'm';
        const maxValue = unit === 'm' ? 10 : 1000;
        return `طول نمی‌تواند بیشتر از ${maxValue} ${unit === 'm' ? 'متر' : 'سانتی‌متر'} باشد`;
      }
      return null;
    }

    case 'width':
      if (value === null || value === undefined) {
        return `لطفاً عرض را برای ${partLabel} وارد کنید`;
      }
      if (value <= 0) {
        return `عرض باید بیشتر از صفر باشد`;
      }
      if (originalWidthCm > 0 && value > originalWidthCm) {
        return `عرض وارد شده (${formatDisplayNumber(value)}cm) نمی‌تواند بیشتر از عرض اصلی سنگ (${formatDisplayNumber(originalWidthCm)}cm) باشد`;
      }
      if (value < 1) {
        return `عرض باید حداقل 1 سانتی‌متر باشد`;
      }
      return null;

    case 'quantity':
      if (value === null || value === undefined) {
        return `لطفاً تعداد را برای ${partLabel} وارد کنید`;
      }
      if (value <= 0) {
        return `تعداد باید بیشتر از صفر باشد`;
      }
      if (!Number.isInteger(value)) {
        return `تعداد باید یک عدد صحیح باشد`;
      }
      if (value > 10000) {
        return `تعداد نمی‌تواند بیشتر از 10,000 عدد باشد`;
      }
      return null;

    case 'pricePerSquareMeter':
      if (value === null || value === undefined) {
        return `لطفاً قیمت هر متر مربع را برای ${partLabel} وارد کنید`;
      }
      if (value <= 0) {
        return `قیمت هر متر مربع باید بیشتر از صفر باشد`;
      }
      if (value > 100000000) { // Reasonable max: 100 million Toman per sqm
        return `قیمت هر متر مربع نمی‌تواند بیشتر از 100,000,000 تومان باشد`;
      }
      return null;

    case 'layerStonePrice':
      if (value === null || value === undefined) {
        return 'لطفاً قیمت هر متر مربع لایه را وارد کنید';
      }
      if (value <= 0) {
        return 'قیمت هر متر مربع لایه باید بیشتر از صفر باشد';
      }
      if (value > 100000000) {
        return 'قیمت هر متر مربع لایه نمی‌تواند بیشتر از 100,000,000 تومان باشد';
      }
      return null;

    case 'layerMandatoryPercentage':
      if (value === null || value === undefined) {
        return 'لطفاً درصد حکمی لایه را وارد کنید';
      }
      if (value < 0) {
        return 'درصد حکمی نمی‌تواند کمتر از 0 باشد';
      }
      if (value > 100) {
        return 'درصد حکمی نمی‌تواند بیشتر از 100 باشد';
      }
      return null;

    case 'mandatoryPercentage':
      if (value === null || value === undefined) {
        return `لطفاً درصد حکمی ${partLabel} را وارد کنید`;
      }
      if (value < 0) {
        return 'درصد حکمی نمی‌تواند کمتر از 0 باشد';
      }
      if (value > 100) {
        return 'درصد حکمی نمی‌تواند بیشتر از 100 باشد';
      }
      return null;

    case 'thickness':
      // Thickness is auto-set from product, but validate it matches
      if (originalThicknessCm > 0) {
        const currentThickness = draft.thicknessCm ?? 0;
        if (Math.abs(currentThickness - originalThicknessCm) > 0.01) {
          return `قطر باید با قطر محصول انتخاب شده (${formatDisplayNumber(originalThicknessCm)}cm) مطابقت داشته باشد`;
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
    errors.thickness = `لطفاً ابتدا محصول ${partLabel} را انتخاب کنید`;
    return errors; // Can't validate other fields without product
  }

  // Validate each field using the comprehensive validation function
  const lengthError = validateDraftNumericFields(part, draft, 'length', draft.lengthValue ?? null, layerTypes);
  if (lengthError) errors.length = lengthError;

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

  if (draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && layerTypes.length > 0 && !draft.layerTypeId) {
    errors.layerType = 'لطفاً نوع لایه را انتخاب کنید';
  }

  if (draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && draft.layerUseDifferentStone) {
    if (!draft.layerStoneProduct || !draft.layerStoneProductId) {
      errors.layerStone = 'لطفاً سنگ مورد استفاده برای لایه‌ها را انتخاب کنید';
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

