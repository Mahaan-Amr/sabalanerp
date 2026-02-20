// Stone cutting calculation service
// Handles all stone cutting calculations for different product types

import type { StoneCut, RemainingStone, StonePartition, WidthSlice, PartitionPositioningResult, PartitionValidationResult } from '../types/contract.types';
import { formatDisplayNumber } from '../utils/formatUtils';

/**
 * Calculate longitudinal stone cutting (1D cutting)
 */
export const calculateLongitudinalCut = (data: {
  originalWidth: number;
  desiredWidth: number;
  length: number;
  cuttingCostPerMeter: number;
  quantity?: number;
  lengthUnit?: 'cm' | 'm';
}): {
  cutDetails: StoneCut;
  remainingStone: RemainingStone;
  cuttingCost: number;
  remainingWidth: number;
} => {
  const { originalWidth, desiredWidth, length, cuttingCostPerMeter, quantity = 1, lengthUnit = 'cm' } = data;
  
  // Convert length to cm for calculations
  const lengthInCm = lengthUnit === 'm' ? length * 100 : length;
  
  // Calculate remaining width after cut
  const remainingWidth = originalWidth - desiredWidth;
  
  // Calculate cutting cost
  const cuttingCost = (lengthInCm / 100) * cuttingCostPerMeter * quantity;
  
  // Create cut details
  const cutId = `cut_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const cutDetails: StoneCut = {
    id: cutId,
    originalWidth,
    cutWidth: desiredWidth,
    remainingWidth,
    length: lengthInCm,
    cuttingCost,
    cuttingCostPerMeter
  };
  
  // Create remaining stone
  const remainingStoneId = `remaining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const remainingStone: RemainingStone = {
    id: remainingStoneId,
    width: remainingWidth,
    length: lengthInCm,
    squareMeters: (remainingWidth * lengthInCm * quantity) / 10000, // Convert cm² to m²
    isAvailable: remainingWidth > 0,
    sourceCutId: cutId
  };
  
  return {
    cutDetails,
    remainingStone,
    cuttingCost,
    remainingWidth
  };
};

/**
 * Calculate slab stone cutting (2D cutting: longitudinal + cross)
 */
export const calculateSlabCut = (data: {
  originalLength: number; // طول اصلی اسلب (in cm or m)
  originalWidth: number; // عرض اصلی اسلب (in cm)
  desiredLength: number; // طول مورد نظر (in cm or m)
  desiredWidth: number; // عرض مورد نظر (in cm or m)
  lengthUnit?: 'cm' | 'm';
  widthUnit?: 'cm' | 'm';
  cuttingCostPerMeterLongitudinal?: number; // هزینه برش طولی
  cuttingCostPerMeterCross?: number; // هزینه برش عرضی
  quantity?: number;
  longitudinalCutLengthMeters?: number;
  crossCutLengthMeters?: number;
}): {
  cutDetails: StoneCut[];
  remainingPieces: RemainingStone[];
  totalCuttingCost: number;
  longitudinalCuttingCost: number;
  crossCuttingCost: number;
  needsLongitudinalCut: boolean;
  needsCrossCut: boolean;
  remainingWidth: number;
  remainingLength: number;
} => {
  const {
    originalLength,
    originalWidth,
    desiredLength,
    desiredWidth,
    lengthUnit = 'm',
    widthUnit = 'cm',
    cuttingCostPerMeterLongitudinal = 0,
    cuttingCostPerMeterCross = 0,
    quantity = 1,
    longitudinalCutLengthMeters,
    crossCutLengthMeters
  } = data;
  
  // Convert all dimensions to cm for calculations
  const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
  const originalWidthCm = widthUnit === 'm' ? originalWidth * 100 : originalWidth;
  const desiredLengthCm = lengthUnit === 'm' ? desiredLength * 100 : desiredLength;
  const desiredWidthCm = widthUnit === 'm' ? desiredWidth * 100 : desiredWidth;
  
  // Determine if cuts are needed
  const needsLongitudinalCut = desiredWidthCm < originalWidthCm && desiredWidthCm > 0;
  const needsCrossCut = desiredLengthCm < originalLengthCm && desiredLengthCm > 0;
  
  // Calculate cutting costs
  let longitudinalCuttingCost = 0;
  let crossCuttingCost = 0;
  
  const effectiveLongitudinalMeters = longitudinalCutLengthMeters ?? (desiredLengthCm / 100);
  const effectiveCrossMeters = crossCutLengthMeters ?? (desiredWidthCm / 100);
  
  if (needsLongitudinalCut && cuttingCostPerMeterLongitudinal > 0) {
    longitudinalCuttingCost = effectiveLongitudinalMeters * cuttingCostPerMeterLongitudinal * quantity;
  }
  
  if (needsCrossCut && cuttingCostPerMeterCross > 0) {
    crossCuttingCost = effectiveCrossMeters * cuttingCostPerMeterCross * quantity;
  }
  
  const totalCuttingCost = longitudinalCuttingCost + crossCuttingCost;
  
  // Generate cut IDs once for reuse in both cut details and remaining pieces
  const timestamp = Date.now();
  const longitudinalCutId = needsLongitudinalCut ? `cut_longitudinal_${timestamp}_${Math.random().toString(36).substr(2, 9)}` : '';
  const crossCutId = needsCrossCut ? `cut_cross_${timestamp}_${Math.random().toString(36).substr(2, 9)}` : '';
  
  // Calculate remaining pieces (can be multiple pieces for 2D cutting)
  const remainingPieces: RemainingStone[] = [];
  
  if (needsLongitudinalCut || needsCrossCut) {
    const remainingWidth = originalWidthCm - desiredWidthCm;
    const remainingLength = originalLengthCm - desiredLengthCm;
    
    // Piece 1: Remaining width piece (if longitudinal cut)
    if (remainingWidth > 0 && desiredLengthCm > 0) {
      const pieceId1 = `remaining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      remainingPieces.push({
        id: pieceId1,
        width: remainingWidth,
        length: desiredLengthCm,
        squareMeters: (remainingWidth * desiredLengthCm * quantity) / 10000,
        isAvailable: remainingWidth > 0,
        sourceCutId: longitudinalCutId || crossCutId || '',
        position: {
          startWidth: desiredWidthCm,
          startLength: 0
        }
      });
    }
    
    // Piece 2: Remaining length piece (if cross cut)
    if (remainingLength > 0 && desiredWidthCm > 0) {
      const pieceId2 = `remaining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      remainingPieces.push({
        id: pieceId2,
        width: desiredWidthCm,
        length: remainingLength,
        squareMeters: (desiredWidthCm * remainingLength * quantity) / 10000,
        isAvailable: remainingLength > 0,
        sourceCutId: crossCutId || longitudinalCutId || '',
        position: {
          startWidth: 0,
          startLength: desiredLengthCm
        }
      });
    }
    
    // Piece 3: Corner piece (if both cuts)
    if (remainingWidth > 0 && remainingLength > 0) {
      const pieceId3 = `remaining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      remainingPieces.push({
        id: pieceId3,
        width: remainingWidth,
        length: remainingLength,
        squareMeters: (remainingWidth * remainingLength * quantity) / 10000,
        isAvailable: remainingWidth > 0 && remainingLength > 0,
        sourceCutId: crossCutId || longitudinalCutId || '',
        position: {
          startWidth: desiredWidthCm,
          startLength: desiredLengthCm
        }
      });
    }
  }
  
  // Create cut details
  const cutDetails: StoneCut[] = [];
  
  if (needsLongitudinalCut && cuttingCostPerMeterLongitudinal > 0) {
    cutDetails.push({
      id: longitudinalCutId,
      originalWidth: originalWidthCm,
      cutWidth: desiredWidthCm,
      remainingWidth: originalWidthCm - desiredWidthCm,
      length: effectiveLongitudinalMeters * 100,
      cuttingCost: longitudinalCuttingCost,
      cuttingCostPerMeter: cuttingCostPerMeterLongitudinal
    });
  }
  
  if (needsCrossCut && cuttingCostPerMeterCross > 0) {
    cutDetails.push({
      id: crossCutId,
      originalWidth: originalLengthCm, // For cross cut, we use length as "width" conceptually
      cutWidth: desiredLengthCm,
      remainingWidth: originalLengthCm - desiredLengthCm,
      length: effectiveCrossMeters * 100,
      cuttingCost: crossCuttingCost,
      cuttingCostPerMeter: cuttingCostPerMeterCross
    });
  }
  
  return {
    cutDetails,
    remainingPieces,
    totalCuttingCost,
    longitudinalCuttingCost,
    crossCuttingCost,
    needsLongitudinalCut,
    needsCrossCut,
    remainingWidth: originalWidthCm - desiredWidthCm,
    remainingLength: originalLengthCm - desiredLengthCm
  };
};

/**
 * Calculate partition positions in a stone
 * Positions partitions in user-defined order, respecting sequential cutting logic
 */
export const calculatePartitions = (
  partitions: StonePartition[],
  availableWidth: number, // in cm
  availableLength: number // in meters
): StonePartition[] => {
  // Filter out empty partitions
  const validPartitions = partitions.filter(p => p.width > 0 && p.length > 0);
  
  if (validPartitions.length === 0) return partitions;
  
  // IMPORTANT: Respect user-defined order (no sorting) for sequential cutting
  // Users add partitions in the order they want to cut them
  
  // Start with one full width slice
  const widthSlices: WidthSlice[] = [{
    startWidth: 0,
    width: availableWidth,
    remainingLength: availableLength,
    startLength: 0
  }];
  
  const positionedPartitions: StonePartition[] = [];
  const partitionErrors = new Map<string, string>();
  
  for (const partition of validPartitions) {
    // Find a width slice that can accommodate this partition
    let placed = false;
    
    for (let i = 0; i < widthSlices.length; i++) {
      const slice = widthSlices[i];
      
      // Check if partition fits in this slice
      if (partition.width <= slice.width && partition.length <= slice.remainingLength) {
        // Fits! Place it in this slice
        positionedPartitions.push({
          ...partition,
          position: {
            startWidth: slice.startWidth,
            startLength: slice.startLength
          },
          validationError: undefined
        });
        
        // Update the slice based on how the partition was cut
        if (partition.width === slice.width) {
          // Used full width of this slice - just update remaining length
          slice.remainingLength -= partition.length;
          slice.startLength += partition.length;
          
          // If this slice is now fully used, remove it
          if (slice.remainingLength <= 0) {
            widthSlices.splice(i, 1);
          }
        } else {
          // Used partial width - need to split the slice
          // Create new slice for the remaining width portion (unused width)
          const remainingWidthSlice: WidthSlice = {
            startWidth: slice.startWidth + partition.width,
            width: slice.width - partition.width,
            remainingLength: slice.remainingLength, // Full length still available
            startLength: slice.startLength // Same starting position
          };
          
          // Update the used slice (now represents the used width portion)
          slice.width = partition.width;
          slice.remainingLength -= partition.length;
          slice.startLength += partition.length;
          
          // Add the remaining width slice if it has positive dimensions
          if (remainingWidthSlice.width > 0 && remainingWidthSlice.remainingLength > 0) {
            widthSlices.splice(i + 1, 0, remainingWidthSlice);
          }
          
          // Remove the used slice if it's fully used
          if (slice.remainingLength <= 0) {
            widthSlices.splice(i, 1);
            i--; // Adjust index since we removed an element
          }
          
          // Sort slices by startWidth for easier management
          widthSlices.sort((a, b) => a.startWidth - b.startWidth);
        }
        
        placed = true;
        break;
      }
    }
    
    if (!placed) {
      // Couldn't place this partition - find the best slice to show error
      let bestSlice: WidthSlice | null = null;
      
      for (const slice of widthSlices) {
        if (partition.width <= slice.width && partition.length <= slice.remainingLength) {
          bestSlice = slice;
          break;
        }
        
        // Track the slice with the most available space
        if (!bestSlice || (slice.width * slice.remainingLength) > (bestSlice.width * bestSlice.remainingLength)) {
          bestSlice = slice;
        }
      }
      
      // Set appropriate error message
      if (bestSlice) {
        if (partition.width > bestSlice.width) {
          partitionErrors.set(partition.id, `عرض پارتیشن (${formatDisplayNumber(partition.width)}cm) بیش از عرض باقی‌مانده (${formatDisplayNumber(bestSlice.width)}cm) است`);
        } else if (partition.length > bestSlice.remainingLength) {
          partitionErrors.set(partition.id, `طول پارتیشن (${formatDisplayNumber(partition.length)}m) بیش از طول باقی‌مانده (${formatDisplayNumber(bestSlice.remainingLength)}m) است`);
        } else {
          partitionErrors.set(partition.id, `این پارتیشن نمی‌تواند در محدوده باقی‌مانده قرار گیرد`);
        }
      } else {
        partitionErrors.set(partition.id, `این پارتیشن نمی‌تواند در محدوده باقی‌مانده قرار گیرد`);
      }
      
      positionedPartitions.push({
        ...partition,
        position: undefined,
        validationError: partitionErrors.get(partition.id)
      });
    }
  }
  
  // Map back to original order using IDs, preserving errors
  const resultMap = new Map<string, StonePartition>();
  positionedPartitions.forEach(p => resultMap.set(p.id, p));
  
  // Merge with empty partitions (keep them as-is)
  const emptyPartitions = partitions.filter(p => !p.width || !p.length);
  const result = partitions
    .filter(p => p.width > 0 && p.length > 0)
    .map(p => resultMap.get(p.id) || { ...p, validationError: partitionErrors.get(p.id) || undefined })
    .concat(emptyPartitions);
  
  return result;
};

/**
 * Calculate partition positions with remaining width slices
 * Returns both positioned partitions AND remaining width slices
 */
export const calculatePartitionsWithSlices = (
  partitions: StonePartition[],
  availableWidth: number, // in cm
  availableLength: number // in meters
): PartitionPositioningResult => {
  // Filter out empty partitions
  const validPartitions = partitions.filter(p => p.width > 0 && p.length > 0);
  
  if (validPartitions.length === 0) {
    return {
      positionedPartitions: partitions,
      remainingWidthSlices: [{
        startWidth: 0,
        width: availableWidth,
        remainingLength: availableLength,
        startLength: 0
      }]
    };
  }
  
  // Start with one full width slice
  const widthSlices: WidthSlice[] = [{
    startWidth: 0,
    width: availableWidth,
    remainingLength: availableLength,
    startLength: 0
  }];
  
  const positionedPartitions: StonePartition[] = [];
  const partitionErrors = new Map<string, string>();
  
  for (const partition of validPartitions) {
    // Find a width slice that can accommodate this partition
    let placed = false;
    
    for (let i = 0; i < widthSlices.length; i++) {
      const slice = widthSlices[i];
      
      // Check if partition fits in this slice
      if (partition.width <= slice.width && partition.length <= slice.remainingLength) {
        // Fits! Place it in this slice
        positionedPartitions.push({
          ...partition,
          position: {
            startWidth: slice.startWidth,
            startLength: slice.startLength
          },
          validationError: undefined
        });
        
        // Update the slice based on how the partition was cut
        if (partition.width === slice.width) {
          // Used full width of this slice - just update remaining length
          slice.remainingLength -= partition.length;
          slice.startLength += partition.length;
          
          // If this slice is now fully used, remove it
          if (slice.remainingLength <= 0) {
            widthSlices.splice(i, 1);
          }
        } else {
          // Used partial width - need to split the slice
          const remainingWidthSlice: WidthSlice = {
            startWidth: slice.startWidth + partition.width,
            width: slice.width - partition.width,
            remainingLength: slice.remainingLength,
            startLength: slice.startLength
          };
          
          // Update the used slice
          slice.width = partition.width;
          slice.remainingLength -= partition.length;
          slice.startLength += partition.length;
          
          // Add the remaining width slice if it has positive dimensions
          if (remainingWidthSlice.width > 0 && remainingWidthSlice.remainingLength > 0) {
            widthSlices.splice(i + 1, 0, remainingWidthSlice);
          }
          
          // Remove the used slice if it's fully used
          if (slice.remainingLength <= 0) {
            widthSlices.splice(i, 1);
            i--; // Adjust index
          }
          
          // Sort slices by startWidth
          widthSlices.sort((a, b) => a.startWidth - b.startWidth);
        }
        
        placed = true;
        break;
      }
    }
    
    if (!placed) {
      // Couldn't place this partition
      let bestSlice: WidthSlice | null = null;
      
      for (const slice of widthSlices) {
        if (partition.width <= slice.width && partition.length <= slice.remainingLength) {
          bestSlice = slice;
          break;
        }
        
        if (!bestSlice || (slice.width * slice.remainingLength) > (bestSlice.width * bestSlice.remainingLength)) {
          bestSlice = slice;
        }
      }
      
      // Set error message
      if (bestSlice) {
        if (partition.width > bestSlice.width) {
          partitionErrors.set(partition.id, `عرض پارتیشن (${formatDisplayNumber(partition.width)}cm) بیش از عرض باقی‌مانده (${formatDisplayNumber(bestSlice.width)}cm) است`);
        } else if (partition.length > bestSlice.remainingLength) {
          partitionErrors.set(partition.id, `طول پارتیشن (${formatDisplayNumber(partition.length)}m) بیش از طول باقی‌مانده (${formatDisplayNumber(bestSlice.remainingLength)}m) است`);
        } else {
          partitionErrors.set(partition.id, `این پارتیشن نمی‌تواند در محدوده باقی‌مانده قرار گیرد`);
        }
      } else {
        partitionErrors.set(partition.id, `این پارتیشن نمی‌تواند در محدوده باقی‌مانده قرار گیرد`);
      }
      
      positionedPartitions.push({
        ...partition,
        position: undefined,
        validationError: partitionErrors.get(partition.id)
      });
    }
  }
  
  // Map back to original order
  const resultMap = new Map<string, StonePartition>();
  positionedPartitions.forEach(p => resultMap.set(p.id, p));
  
  const emptyPartitions = partitions.filter(p => !p.width || !p.length);
  const result = partitions
    .filter(p => p.width > 0 && p.length > 0)
    .map(p => resultMap.get(p.id) || { ...p, validationError: partitionErrors.get(p.id) || undefined })
    .concat(emptyPartitions);
  
  // Filter out fully used slices
  const remainingWidthSlices = widthSlices.filter(slice => slice.remainingLength > 0 && slice.width > 0);
  
  return {
    positionedPartitions: result,
    remainingWidthSlices
  };
};

/**
 * Validate partitions
 */
export const validatePartitions = (
  partitions: StonePartition[],
  availableWidth: number, // in cm
  availableLength: number, // in meters
  availableSquareMeters: number
): PartitionValidationResult => {
  const validPartitions = partitions.filter(p => p.width > 0 && p.length > 0);
  const partitionErrors = new Map<string, string>();
  
  if (validPartitions.length === 0) {
    return {
      isValid: false,
      error: 'لطفاً حداقل ÛŒÚ© پارتیشن با ابعاد معتبر تعریف کنید',
      partitionErrors,
      validatedPartitions: partitions
    };
  }
  
  // Validate each partition fits within bounds
  for (const partition of validPartitions) {
    if (partition.width > availableWidth) {
      partitionErrors.set(partition.id, `عرض (${formatDisplayNumber(partition.width)}cm) بیش از عرض موجود (${formatDisplayNumber(availableWidth)}cm) است`);
    }
    if (partition.length > availableLength) {
      partitionErrors.set(partition.id, `طول (${formatDisplayNumber(partition.length)}m) بیش از طول موجود (${formatDisplayNumber(availableLength)}m) است`);
    }
  }
  
  // Calculate total area used
  const totalUsedSquareMeters = validPartitions.reduce((sum, p) => sum + p.squareMeters, 0);
  
  if (totalUsedSquareMeters > availableSquareMeters) {
    // Add area error to all partitions that contributed
    validPartitions.forEach(partition => {
      if (!partitionErrors.has(partition.id)) {
        partitionErrors.set(partition.id, `مجموع متر مربع پارتیشن‌ها (${formatDisplayNumber(totalUsedSquareMeters)}) بیش از متر مربع موجود (${formatDisplayNumber(availableSquareMeters)}) است`);
      }
    });
    
    return {
      isValid: false,
      error: `مجموع متر مربع پارتیشن‌ها (${formatDisplayNumber(totalUsedSquareMeters)}) نمی‌تواند بیشتر از متر مربع موجود (${formatDisplayNumber(availableSquareMeters)}) باشد`,
      partitionErrors,
      validatedPartitions: partitions.map(p => ({
        ...p,
        validationError: partitionErrors.get(p.id)
      }))
    };
  }
  
  // Check positioning
  const positionedPartitions = calculatePartitions(validPartitions, availableWidth, availableLength);
  
  // Collect errors from positioning
  positionedPartitions.forEach(partition => {
    if (partition.validationError && !partitionErrors.has(partition.id)) {
      partitionErrors.set(partition.id, partition.validationError);
    }
    if (!partition.position && !partitionErrors.has(partition.id)) {
      partitionErrors.set(partition.id, 'این پارتیشن نمی‌تواند در محدوده موجود قرار گیرد. لطفاً ابعاد را کاهش دهید یا آن را حذف کنید.');
    }
  });
  
  // Check for overlaps between partitions
  for (let i = 0; i < positionedPartitions.length; i++) {
    const p1 = positionedPartitions[i];
    if (!p1.position) continue;
    
    for (let j = i + 1; j < positionedPartitions.length; j++) {
      const p2 = positionedPartitions[j];
      if (!p2.position) continue;
      
      // Check if rectangles overlap
      const p1EndWidth = p1.position.startWidth + p1.width;
      const p1EndLength = p1.position.startLength + p1.length;
      const p2EndWidth = p2.position.startWidth + p2.width;
      const p2EndLength = p2.position.startLength + p2.length;
      
      const overlaps = !(
        p1EndWidth <= p2.position.startWidth ||
        p2EndWidth <= p1.position.startWidth ||
        p1EndLength <= p2.position.startLength ||
        p2EndLength <= p1.position.startLength
      );
      
      if (overlaps) {
        partitionErrors.set(p1.id, 'این پارتیشن با پارتیشن دیگر هم‌پوشانی دارد');
        partitionErrors.set(p2.id, 'این پارتیشن با پارتیشن دیگر هم‌پوشانی دارد');
      }
    }
  }
  
  // Build result with errors mapped to original partition order
  const validatedPartitions = partitions.map(p => {
    const positioned = positionedPartitions.find(pos => pos.id === p.id);
    return {
      ...p,
      validationError: partitionErrors.get(p.id) || positioned?.validationError || undefined,
      position: positioned?.position
    };
  });
  
  const hasErrors = partitionErrors.size > 0;
  
  return {
    isValid: !hasErrors,
    error: hasErrors 
      ? `${partitionErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`
      : undefined,
    partitionErrors,
    validatedPartitions
  };
};

/**
 * Calculate remaining areas after partitions are placed
 */
export const calculateRemainingAreasAfterPartitions = (
  partitions: StonePartition[],
  availableWidth: number, // in cm
  availableLength: number // in meters
): RemainingStone[] => {
  const validPartitions = partitions.filter(p => p.width > 0 && p.length > 0);
  if (validPartitions.length === 0) {
    // No partitions - entire area is remaining
    return [{
      id: `remaining_all_${Date.now()}`,
      width: availableWidth,
      length: availableLength,
      squareMeters: (availableWidth * availableLength * 100) / 10000, // Convert to m²
      isAvailable: true,
      sourceCutId: ''
    }];
  }
  
  // Use the positioning function that returns remaining width slices
  const positioningResult = calculatePartitionsWithSlices(validPartitions, availableWidth, availableLength);
  const remainingWidthSlices = positioningResult.remainingWidthSlices;
  
  // Convert remaining width slices to RemainingStone objects
  const remainingPieces: RemainingStone[] = [];
  const timestampForIds = Date.now();
  
  for (let i = 0; i < remainingWidthSlices.length; i++) {
    const slice = remainingWidthSlices[i];
    
    if (slice.width > 0 && slice.remainingLength > 0) {
      remainingPieces.push({
        id: `remaining_slice_${timestampForIds}_${i}`,
        width: slice.width,
        length: slice.remainingLength,
        squareMeters: (slice.width * slice.remainingLength * 100) / 10000, // Convert to m²
        isAvailable: true,
        sourceCutId: '',
        position: {
          startWidth: slice.startWidth,
          startLength: slice.startLength
        }
      });
    }
  }
  
  // Filter out pieces with invalid dimensions
  return remainingPieces.filter(p => p.width > 0 && p.length > 0 && p.squareMeters > 0);
};

/**
 * Validate cut dimensions
 */
export const validateCutDimensions = (
  originalWidth: number,
  originalLength: number,
  desiredWidth: number,
  desiredLength: number,
  originalLengthUnit: 'cm' | 'm' = 'm',
  desiredLengthUnit: 'cm' | 'm' = 'm'
): { isValid: boolean; error?: string } => {
  const originalLengthCm = originalLengthUnit === 'm' ? originalLength * 100 : originalLength;
  const desiredLengthCm = desiredLengthUnit === 'm' ? desiredLength * 100 : desiredLength;
  
  if (desiredWidth > originalWidth) {
    return {
      isValid: false,
      error: `عرض مورد نظر (${formatDisplayNumber(desiredWidth)}cm) نمی‌تواند بیشتر از عرض اصلی (${formatDisplayNumber(originalWidth)}cm) باشد`
    };
  }
  
  if (desiredLengthCm > originalLengthCm) {
    return {
      isValid: false,
      error: `طول مورد نظر (${formatDisplayNumber(desiredLengthCm)}cm) نمی‌تواند بیشتر از طول اصلی (${formatDisplayNumber(originalLengthCm)}cm) باشد`
    };
  }
  
  if (desiredWidth <= 0 || desiredLengthCm <= 0) {
    return {
      isValid: false,
      error: 'ابعاد مورد نظر باید بزرگتر از صفر باشند'
    };
  }
  
  return { isValid: true };
};

/**
 * Calculate remaining stones from cuts
 */
export const calculateRemainingStones = (cuts: StoneCut[]): RemainingStone[] => {
  // This function would process cuts and return remaining stones
  // Implementation depends on how cuts are structured
  return [];
};
