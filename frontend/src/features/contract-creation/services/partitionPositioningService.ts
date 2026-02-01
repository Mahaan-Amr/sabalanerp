import type { StonePartition, WidthSlice } from '../types/contract.types';
import { formatDisplayNumber } from '@/lib/numberFormat';

/**
 * Calculates optimal positioning for stone partitions in available space.
 *
 * This function positions partitions in user-defined order, respecting sequential cutting logic.
 * It manages width slices to track available space as partitions are placed.
 *
 * @param partitions - Array of stone partitions to position
 * @param availableWidth - Available width in centimeters
 * @param availableLength - Available length in meters
 * @returns Array of partitions with position and validation information
 */
export const calculatePartitionPositions = (
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
  const partitionErrors: Map<string, string> = new Map();

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
          // The used portion: from slice.startWidth to slice.startWidth + partition.width
          // The remaining portion: from slice.startWidth + partition.width to slice.startWidth + slice.width

          // Create new slice for the remaining width portion (unused width)
          const remainingWidthSlice: WidthSlice = {
            startWidth: slice.startWidth + partition.width,
            width: slice.width - partition.width,
            remainingLength: slice.remainingLength, // Full length still available
            startLength: slice.startLength // Same starting position
          };

          // Update the used slice (now represents the used width portion)
          slice.width = partition.width; // This slice now represents only the used width
          slice.remainingLength -= partition.length; // Reduce by partition length
          slice.startLength += partition.length; // Move start forward

          // Add the remaining width slice if it has positive dimensions
          if (remainingWidthSlice.width > 0 && remainingWidthSlice.remainingLength > 0) {
            widthSlices.splice(i + 1, 0, remainingWidthSlice);
          }

          // Remove the used slice if it's fully used
          if (slice.remainingLength <= 0) {
            widthSlices.splice(i, 1);
            // Adjust index since we removed an element
            i--;
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
      let bestFit = false;

      for (const slice of widthSlices) {
        if (partition.width <= slice.width && partition.length <= slice.remainingLength) {
          bestSlice = slice;
          bestFit = true;
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
 * Validates if a single partition can fit in the available space.
 *
 * @param partition - The partition to validate
 * @param availableWidth - Available width in centimeters
 * @param availableLength - Available length in meters
 * @returns Validation result with isValid flag and optional error message
 */
export const validatePartitionFit = (
  partition: StonePartition,
  availableWidth: number,
  availableLength: number
): { isValid: boolean; error?: string } => {
  if (!partition.width || !partition.length) {
    return { isValid: false, error: 'ابعاد پارتیشن نامعتبر است' };
  }

  if (partition.width > availableWidth) {
    return {
      isValid: false,
      error: `عرض پارتیشن (${formatDisplayNumber(partition.width)}cm) بیش از عرض موجود (${formatDisplayNumber(availableWidth)}cm) است`
    };
  }

  if (partition.length > availableLength) {
    return {
      isValid: false,
      error: `طول پارتیشن (${formatDisplayNumber(partition.length)}m) بیش از طول موجود (${formatDisplayNumber(availableLength)}m) است`
    };
  }

  return { isValid: true };
};
