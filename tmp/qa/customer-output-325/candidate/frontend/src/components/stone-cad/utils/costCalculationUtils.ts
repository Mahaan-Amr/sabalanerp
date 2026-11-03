/**
 * Cost Calculation Utilities
 * Extract dimensions from CAD design and calculate costs
 */

import { CADState, CADShape } from '../types/CADTypes';

// SlabStandardDimensionEntry type definition (matches the one in page.tsx)
interface SlabStandardDimensionEntry {
  id: string;
  standardLengthCm: number;
  standardWidthCm: number;
  quantity: number;
}

/**
 * Extract dimensions from CAD design
 * Returns the dimensions of the largest rectangle (representing desired cut)
 */
export function extractDimensionsFromDesign(
  cadState: CADState,
  productType: 'longitudinal' | 'slab'
): {
  length?: number; // meters
  width?: number; // cm
  squareMeters?: number;
  shapes: Array<{ type: string; dimensions: any }>;
} {
  // Find all rectangle shapes (representing desired cuts)
  const rectangles = cadState.shapes.filter(s => s.type === 'rectangle' && s.metadata?.representsCut);
  
  if (rectangles.length === 0) {
    return { shapes: [] };
  }
  
  // For now, use the largest rectangle as the desired dimension
  // In future, can support multiple pieces
  const largestRect = rectangles.reduce((largest, current) => {
    const currentArea = (current.width || 0) * (current.height || 0);
    const largestArea = (largest.width || 0) * (largest.height || 0);
    return currentArea > largestArea ? current : largest;
  }, rectangles[0]);
  
  // Extract dimensions from metadata if available, otherwise calculate
  if (largestRect.metadata?.dimensions) {
    const dims = largestRect.metadata.dimensions;
    return {
      length: dims.length, // Already in meters
      width: dims.width, // Already in cm
      squareMeters: dims.squareMeters,
      shapes: rectangles.map(r => ({
        type: r.type,
        dimensions: {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          metadata: r.metadata
        }
      }))
    };
  }
  
  // Fallback: calculate from shape dimensions
  const length = (largestRect.height || 0) / 100; // Convert cm to meters
  const width = largestRect.width || 0; // Already in cm
  const squareMeters = (length * 100 * width) / 10000;
  
  return {
    length,
    width,
    squareMeters,
    shapes: rectangles.map(r => ({
      type: r.type,
      dimensions: {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height
      }
    }))
  };
}

/**
 * Calculate cutting costs from CAD design for slab stones
 * This integrates with the existing calculateSlabCutting function
 */
export function calculateSlabCostsFromDesign(
  cadState: CADState,
  extractedDimensions: {
    length?: number;
    width?: number;
    squareMeters?: number;
  },
  standardDimensions: SlabStandardDimensionEntry[],
  cuttingCostPerMeterLongitudinal: number,
  cuttingCostPerMeterCross: number,
  slabCuttingMode: 'lineBased' | 'perSquareMeter',
  slabCuttingPricePerSquareMeter: number,
  lengthUnit: 'cm' | 'm',
  widthUnit: 'cm' | 'm',
  quantity: number,
  // These functions need to be passed from the parent component
  calculateSlabCuttingFn: (data: any) => any,
  determineSlabLineCutPlanFn: (data: any) => any
): {
  totalCuttingCost: number;
  remainingPieces: any[];
  cutDetails: any[];
  needsLongitudinalCut: boolean;
  needsCrossCut: boolean;
} {
  if (!extractedDimensions.length || !extractedDimensions.width) {
    return {
      totalCuttingCost: 0,
      remainingPieces: [],
      cutDetails: [],
      needsLongitudinalCut: false,
      needsCrossCut: false
    };
  }
  
  const desiredLength = extractedDimensions.length; // meters
  const desiredWidth = extractedDimensions.width; // cm
  
  // Convert to cm for calculations
  const desiredLengthCm = lengthUnit === 'm' ? desiredLength * 100 : desiredLength;
  const desiredWidthCm = widthUnit === 'm' ? desiredWidth * 100 : desiredWidth;
  
  let totalCuttingCost = 0;
  const allRemainingPieces: any[] = [];
  const allCutDetails: any[] = [];
  let hasAnyCut = false;
  
  // Calculate for each standard dimension entry
  for (const entry of standardDimensions) {
    const entryOriginalLengthInCurrentUnit = lengthUnit === 'm' ? entry.standardLengthCm / 100 : entry.standardLengthCm;
    const entryOriginalWidthInCurrentUnit = widthUnit === 'm' ? entry.standardWidthCm / 100 : entry.standardWidthCm;
    
    // Determine line cut plan
    const entryLinePlan = determineSlabLineCutPlanFn({
      requestedLengthCm: desiredLengthCm,
      requestedWidthCm: desiredWidthCm,
      standardLengthCm: entry.standardLengthCm,
      standardWidthCm: entry.standardWidthCm
    });
    
    // Calculate cutting for this entry
    const entrySlabCutting = calculateSlabCuttingFn({
      originalLength: entryOriginalLengthInCurrentUnit,
      originalWidth: entryOriginalWidthInCurrentUnit,
      desiredLength: desiredLength,
      desiredWidth: desiredWidth,
      lengthUnit: lengthUnit,
      widthUnit: widthUnit,
      cuttingCostPerMeterLongitudinal: slabCuttingMode === 'lineBased' ? cuttingCostPerMeterLongitudinal : 0,
      cuttingCostPerMeterCross: slabCuttingMode === 'lineBased' ? cuttingCostPerMeterCross : 0,
      quantity: entry.quantity,
      longitudinalCutLengthMeters: entryLinePlan.longitudinalMeters,
      crossCutLengthMeters: entryLinePlan.crossMeters
    });
    
    if (entrySlabCutting.needsLongitudinalCut || entrySlabCutting.needsCrossCut) {
      hasAnyCut = true;
    }
    
    totalCuttingCost += entrySlabCutting.totalCuttingCost || 0;
    allRemainingPieces.push(...(entrySlabCutting.remainingPieces || []));
    allCutDetails.push(...(entrySlabCutting.cutDetails || []));
  }
  
  // If perSquareMeter mode, calculate based on square meters
  if (slabCuttingMode === 'perSquareMeter' && slabCuttingPricePerSquareMeter > 0 && extractedDimensions.squareMeters) {
    totalCuttingCost = extractedDimensions.squareMeters * slabCuttingPricePerSquareMeter;
  }
  
  return {
    totalCuttingCost,
    remainingPieces: allRemainingPieces,
    cutDetails: allCutDetails,
    needsLongitudinalCut: hasAnyCut && desiredWidthCm > 0 && standardDimensions.some(e => desiredWidthCm < e.standardWidthCm),
    needsCrossCut: hasAnyCut && desiredLengthCm > 0 && standardDimensions.some(e => desiredLengthCm < e.standardLengthCm)
  };
}

/**
 * Calculate cutting costs from CAD design for longitudinal stones
 */
export function calculateLongitudinalCostsFromDesign(
  cadState: CADState,
  extractedDimensions: {
    length?: number;
    width?: number;
    squareMeters?: number;
  },
  originalWidth: number, // cm
  cuttingCostPerMeter: number,
  lengthUnit: 'cm' | 'm',
  widthUnit: 'cm' | 'm',
  quantity: number,
  calculateStoneCuttingFn: (data: any) => any
): {
  cuttingCost: number;
  remainingStone: any | null;
  cutDetails: any | null;
} {
  if (!extractedDimensions.length || !extractedDimensions.width) {
    return {
      cuttingCost: 0,
      remainingStone: null,
      cutDetails: null
    };
  }
  
  const desiredLength = extractedDimensions.length; // meters
  const desiredWidth = extractedDimensions.width; // cm
  
  // Convert to consistent units
  const desiredLengthCm = lengthUnit === 'm' ? desiredLength * 100 : desiredLength;
  const desiredWidthCm = widthUnit === 'm' ? desiredWidth * 100 : desiredWidth;
  
  // Check if cut is needed
  if (desiredWidthCm >= originalWidth || cuttingCostPerMeter <= 0) {
    return {
      cuttingCost: 0,
      remainingStone: null,
      cutDetails: null
    };
  }
  
  // Calculate cutting
  const cuttingResult = calculateStoneCuttingFn({
    originalWidth: originalWidth,
    desiredWidth: desiredWidthCm,
    length: desiredLength,
    cuttingCostPerMeter: cuttingCostPerMeter,
    quantity: quantity,
    lengthUnit: lengthUnit
  });
  
  return {
    cuttingCost: cuttingResult.cuttingCost || 0,
    remainingStone: cuttingResult.remainingStone || null,
    cutDetails: cuttingResult.cutDetails || null
  };
}

