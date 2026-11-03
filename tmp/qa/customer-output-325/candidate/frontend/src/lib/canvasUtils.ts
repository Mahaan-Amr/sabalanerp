/**
 * Canvas coordinate system utilities for Stone Canvas visualization
 * Handles conversion between real units (meters/cm), normalized coordinates (0-1), and canvas pixels
 */

/**
 * Convert length from various units to meters
 * @param value - Length value
 * @param unit - Unit of the value ('cm' or 'm')
 * @returns Length in meters
 */
export const lengthToMeters = (value: number, unit: 'cm' | 'm'): number => {
  if (unit === 'm') return value;
  return value / 100; // Convert cm to meters
};

/**
 * Convert width from various units to centimeters
 * @param value - Width value
 * @param unit - Unit of the value ('cm' or 'm')
 * @returns Width in centimeters
 */
export const widthToCm = (value: number, unit: 'cm' | 'm'): number => {
  if (unit === 'cm') return value;
  return value * 100; // Convert meters to cm
};

/**
 * Convert meters to centimeters
 * @param meters - Length in meters
 * @returns Length in centimeters
 */
export const metersToCm = (meters: number): number => {
  return meters * 100;
};

/**
 * Convert centimeters to meters
 * @param cm - Length in centimeters
 * @returns Length in meters
 */
export const cmToMeters = (cm: number): number => {
  return cm / 100;
};

/**
 * Calculate aspect ratio of a stone
 * @param lengthInMeters - Length in meters
 * @param widthInCm - Width in centimeters
 * @returns Aspect ratio (length/width ratio, both in same units)
 */
export const calculateAspectRatio = (lengthInMeters: number, widthInCm: number): number => {
  if (widthInCm === 0) return 1;
  // Convert both to cm for ratio calculation
  const lengthInCm = metersToCm(lengthInMeters);
  return lengthInCm / widthInCm;
};

/**
 * Convert real-world dimension to normalized coordinate (0-1)
 * @param realValue - Real-world value (in meters for length, cm for width)
 * @param maxRealValue - Maximum real-world value (original dimension)
 * @returns Normalized value between 0 and 1
 */
export const realToNormalized = (realValue: number, maxRealValue: number): number => {
  if (maxRealValue === 0) return 0;
  return Math.max(0, Math.min(1, realValue / maxRealValue));
};

/**
 * Convert normalized coordinate (0-1) to real-world dimension
 * @param normalizedValue - Normalized value between 0 and 1
 * @param maxRealValue - Maximum real-world value (original dimension)
 * @returns Real-world value
 */
export const normalizedToReal = (normalizedValue: number, maxRealValue: number): number => {
  return normalizedValue * maxRealValue;
};

/**
 * Convert normalized coordinate to canvas pixel position
 * @param normalizedValue - Normalized value between 0 and 1
 * @param canvasSize - Canvas dimension in pixels
 * @param padding - Padding from edges in pixels (default: 0)
 * @returns Pixel position on canvas
 */
export const normalizedToPixel = (
  normalizedValue: number,
  canvasSize: number,
  padding: number = 0
): number => {
  const availableSize = canvasSize - (padding * 2);
  return padding + (normalizedValue * availableSize);
};

/**
 * Convert canvas pixel position to normalized coordinate (0-1)
 * @param pixelValue - Pixel position on canvas
 * @param canvasSize - Canvas dimension in pixels
 * @param padding - Padding from edges in pixels (default: 0)
 * @returns Normalized value between 0 and 1
 */
export const pixelToNormalized = (
  pixelValue: number,
  canvasSize: number,
  padding: number = 0
): number => {
  const availableSize = canvasSize - (padding * 2);
  if (availableSize === 0) return 0;
  const adjustedPixel = pixelValue - padding;
  return Math.max(0, Math.min(1, adjustedPixel / availableSize));
};

/**
 * Convert real-world dimension directly to canvas pixel position
 * @param realValue - Real-world value (in meters for length, cm for width)
 * @param maxRealValue - Maximum real-world value (original dimension)
 * @param canvasSize - Canvas dimension in pixels
 * @param padding - Padding from edges in pixels (default: 0)
 * @returns Pixel position on canvas
 */
export const realToPixel = (
  realValue: number,
  maxRealValue: number,
  canvasSize: number,
  padding: number = 0
): number => {
  const normalized = realToNormalized(realValue, maxRealValue);
  return normalizedToPixel(normalized, canvasSize, padding);
};

/**
 * Convert canvas pixel position directly to real-world dimension
 * @param pixelValue - Pixel position on canvas
 * @param maxRealValue - Maximum real-world value (original dimension)
 * @param canvasSize - Canvas dimension in pixels
 * @param padding - Padding from edges in pixels (default: 0)
 * @returns Real-world value
 */
export const pixelToReal = (
  pixelValue: number,
  maxRealValue: number,
  canvasSize: number,
  padding: number = 0
): number => {
  const normalized = pixelToNormalized(pixelValue, canvasSize, padding);
  return normalizedToReal(normalized, maxRealValue);
};

/**
 * Calculate canvas dimensions maintaining aspect ratio
 * @param lengthInMeters - Original length in meters
 * @param widthInCm - Original width in centimeters
 * @param maxWidth - Maximum canvas width in pixels
 * @param maxHeight - Maximum canvas height in pixels
 * @param padding - Padding from edges in pixels (default: 20)
 * @returns Canvas dimensions {width, height}
 */
export const calculateCanvasDimensions = (
  lengthInMeters: number,
  widthInCm: number,
  maxWidth: number,
  maxHeight: number,
  padding: number = 20
): { width: number; height: number } => {
  // Convert both to cm for aspect ratio calculation
  const lengthInCm = metersToCm(lengthInMeters);
  const aspectRatio = widthInCm === 0 ? 1 : lengthInCm / widthInCm;

  // Available space after padding
  const availableWidth = maxWidth - (padding * 2);
  const availableHeight = maxHeight - (padding * 2);

  // Calculate dimensions based on aspect ratio
  let canvasWidth: number;
  let canvasHeight: number;

  // Determine if we're constrained by width or height
  const heightForWidth = availableWidth / aspectRatio;
  const widthForHeight = availableHeight * aspectRatio;

  if (heightForWidth <= availableHeight) {
    // Width is the constraint
    canvasWidth = availableWidth;
    canvasHeight = heightForWidth;
  } else {
    // Height is the constraint
    canvasWidth = widthForHeight;
    canvasHeight = availableHeight;
  }

  // Add padding back
  return {
    width: canvasWidth + (padding * 2),
    height: canvasHeight + (padding * 2)
  };
};

/**
 * Calculate square meters from dimensions
 * @param lengthInMeters - Length in meters
 * @param widthInCm - Width in centimeters
 * @param quantity - Quantity (default: 1)
 * @returns Square meters
 */
export const calculateSquareMeters = (
  lengthInMeters: number,
  widthInCm: number,
  quantity: number = 1
): number => {
  // Convert both to cm for calculation
  const lengthInCm = metersToCm(lengthInMeters);
  return (lengthInCm * widthInCm * quantity) / 10000;
};

/**
 * Rectangle coordinates for canvas rendering
 */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert real-world dimensions to canvas rectangle coordinates
 * @param startLength - Starting length position in meters (from start of original stone)
 * @param lengthSize - Length size in meters
 * @param startWidth - Starting width position in cm (from start of original stone)
 * @param widthSize - Width size in cm
 * @param originalLength - Original length in meters
 * @param originalWidth - Original width in cm
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @param padding - Padding from edges in pixels (default: 20)
 * @returns Canvas rectangle coordinates
 */
export const realToCanvasRect = (
  startLength: number,
  lengthSize: number,
  startWidth: number,
  widthSize: number,
  originalLength: number,
  originalWidth: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): CanvasRect => {
  // Normalize positions and sizes
  const startLengthNormalized = realToNormalized(startLength, originalLength);
  const lengthSizeNormalized = realToNormalized(lengthSize, originalLength);
  const startWidthNormalized = realToNormalized(startWidth, originalWidth);
  const widthSizeNormalized = realToNormalized(widthSize, originalWidth);

  // Convert to pixels
  // Note: In canvas, we typically draw length along X-axis and width along Y-axis
  // But for stone visualization, length is usually the longer dimension
  // We'll use length for X-axis and width for Y-axis
  
  // Calculate start positions
  const x = normalizedToPixel(startLengthNormalized, canvasWidth, padding);
  const y = normalizedToPixel(startWidthNormalized, canvasHeight, padding);
  
  // Calculate end positions (start + size)
  const endLengthNormalized = startLengthNormalized + lengthSizeNormalized;
  const endWidthNormalized = startWidthNormalized + widthSizeNormalized;
  const endX = normalizedToPixel(endLengthNormalized, canvasWidth, padding);
  const endY = normalizedToPixel(endWidthNormalized, canvasHeight, padding);
  
  // Calculate width and height as difference between end and start positions
  const width = endX - x;
  const height = endY - y;

  return { x, y, width, height };
};

/**
 * Check if a point is inside a rectangle
 * @param pointX - X coordinate of the point
 * @param pointY - Y coordinate of the point
 * @param rect - Rectangle to check
 * @returns True if point is inside rectangle
 */
export const isPointInRect = (
  pointX: number,
  pointY: number,
  rect: CanvasRect
): boolean => {
  return (
    pointX >= rect.x &&
    pointX <= rect.x + rect.width &&
    pointY >= rect.y &&
    pointY <= rect.y + rect.height
  );
};

/**
 * Get the remaining stone rectangle coordinates
 * @param remainingStone - Remaining stone data
 * @param originalLength - Original length in meters
 * @param originalWidth - Original width in cm
 * @param usedLength - Used length in meters (from start)
 * @param usedWidth - Used width in cm (from start)
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @param padding - Padding from edges in pixels (default: 20)
 * @returns Canvas rectangle coordinates for the remaining stone
 */
export const getRemainingStoneRect = (
  remainingStone: {
    length: number; // in meters
    width: number; // in cm
  },
  originalLength: number,
  originalWidth: number,
  usedLength: number,
  usedWidth: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): CanvasRect => {
  // For remaining stones, they typically start after used portions
  // Position: start at (usedLength, usedWidth)
  return realToCanvasRect(
    usedLength,
    remainingStone.length,
    usedWidth,
    remainingStone.width,
    originalLength,
    originalWidth,
    canvasWidth,
    canvasHeight,
    padding
  );
};

