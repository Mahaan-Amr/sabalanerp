// Dimension conversion and calculation utilities

/**
 * Convert length from one unit to another
 */
export const convertLength = (value: number, fromUnit: 'cm' | 'm', toUnit: 'cm' | 'm'): number => {
  if (fromUnit === toUnit) return value;
  if (fromUnit === 'm' && toUnit === 'cm') return value * 100;
  if (fromUnit === 'cm' && toUnit === 'm') return value / 100;
  return value;
};

/**
 * Convert width from one unit to another
 */
export const convertWidth = (value: number, fromUnit: 'cm' | 'm', toUnit: 'cm' | 'm'): number => {
  return convertLength(value, fromUnit, toUnit);
};

/**
 * Calculate square meters from length and width
 */
export const calculateSquareMeters = (
  length: number,
  width: number,
  lengthUnit: 'cm' | 'm',
  widthUnit: 'cm' | 'm',
  quantity: number = 1
): number => {
  const lengthInCm = lengthUnit === 'm' ? length * 100 : length;
  const widthInCm = widthUnit === 'm' ? width * 100 : width;
  return (lengthInCm * widthInCm * quantity) / 10000; // Convert cm² to m²
};

/**
 * Calculate length from square meters and width
 */
export const calculateLengthFromSquareMeters = (
  squareMeters: number,
  width: number,
  widthUnit: 'cm' | 'm',
  quantity: number = 1,
  targetUnit: 'cm' | 'm' = 'cm'
): number => {
  const widthInCm = widthUnit === 'm' ? width * 100 : width;
  const lengthInCm = (squareMeters * 10000) / (widthInCm * quantity);
  return targetUnit === 'm' ? lengthInCm / 100 : lengthInCm;
};

/**
 * Calculate width from square meters and length
 */
export const calculateWidthFromSquareMeters = (
  squareMeters: number,
  length: number,
  lengthUnit: 'cm' | 'm',
  quantity: number = 1,
  targetUnit: 'cm' | 'm' = 'cm'
): number => {
  const lengthInCm = lengthUnit === 'm' ? length * 100 : length;
  const widthInCm = (squareMeters * 10000) / (lengthInCm * quantity);
  return targetUnit === 'm' ? widthInCm / 100 : widthInCm;
};

/**
 * Calculate remaining stone dimensions
 */
export const calculateRemainingStoneDimensions = (
  originalWidth: number, // in cm
  originalLength: number, // in meters
  productWidth: number, // in cm
  productLength: number, // in meters (or cm, will be converted)
  productLengthUnit: 'cm' | 'm',
  usedRemainingWidth: number = 0, // in cm
  usedRemainingLength: number = 0 // in meters
): { remainingWidth: number; remainingLength: number; canHaveRemaining: boolean } => {
  const productLengthInMeters = productLengthUnit === 'm' ? productLength : (productLength / 100);
  const remainingWidth = originalWidth - productWidth - usedRemainingWidth;
  const remainingLength = originalLength - productLengthInMeters - usedRemainingLength;
  const canHaveRemaining = originalWidth > 0 && productWidth > 0 && productWidth < originalWidth && remainingWidth > 0 && remainingLength > 0;
  
  return {
    remainingWidth: Math.max(0, remainingWidth),
    remainingLength: Math.max(0, remainingLength),
    canHaveRemaining
  };
};

/**
 * Recalculate total used remaining dimensions from used remaining stones array
 */
export const recalculateUsedRemainingDimensions = (usedRemainingStones: Array<{ width?: number; length?: number }>): {
  totalUsedWidth: number;
  totalUsedLength: number;
} => {
  const totalUsedWidth = usedRemainingStones.reduce((sum, stone) => sum + (stone.width || 0), 0);
  const totalUsedLength = usedRemainingStones.reduce((max, stone) => Math.max(max, stone.length || 0), 0);
  
  return {
    totalUsedWidth,
    totalUsedLength
  };
};

/**
 * Convert value to meters from any unit
 */
export const toMeters = (value: number | null | undefined, unit: 'cm' | 'm'): number => {
  if (!value || value <= 0) return 0;
  return unit === 'm' ? value : value / 100;
};

/**
 * Convert meters to specified unit
 */
export const convertMetersToUnit = (value: number, unit: 'cm' | 'm'): number => {
  if (!value || value <= 0) return 0;
  return unit === 'm' ? value : value * 100;
};

/**
 * Check if draft has length measurement (either manual or standard)
 */
export const hasLengthMeasurement = (draft: {
  lengthValue?: number | null;
  standardLengthValue?: number | null;
  standardLengthUnit?: 'cm' | 'm';
  lengthUnit?: 'cm' | 'm';
}): boolean => {
  if (draft.lengthValue && draft.lengthValue > 0) return true;
  const value = draft.standardLengthValue;
  if (value && value > 0) {
    return true;
  }
  return false;
};

