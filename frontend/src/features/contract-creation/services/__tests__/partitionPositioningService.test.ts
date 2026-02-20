import { calculatePartitionPositions, validatePartitionFit } from '../partitionPositioningService';
import type { StonePartition } from '../../types/contract.types';

describe('partitionPositioningService', () => {
  describe('calculatePartitionPositions', () => {
    it('should position a single partition that fits perfectly', () => {
      const partitions: StonePartition[] = [
        {
          id: '1',
          width: 100, // 100cm
          length: 2, // 2m
          squareMeters: 2
        }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(1);
      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[0].validationError).toBeUndefined();
    });

    it('should position multiple partitions sequentially using full width', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 100, length: 1, squareMeters: 1 },
        { id: '2', width: 100, length: 1, squareMeters: 1 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(2);
      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[1].position).toEqual({ startWidth: 0, startLength: 1 });
      expect(result[0].validationError).toBeUndefined();
      expect(result[1].validationError).toBeUndefined();
    });

    it('should split width slices when partitions use partial width', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 60, length: 1, squareMeters: 0.6 },
        { id: '2', width: 40, length: 1, squareMeters: 0.4 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(2);
      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[1].position).toEqual({ startWidth: 60, startLength: 0 });
      expect(result[0].validationError).toBeUndefined();
      expect(result[1].validationError).toBeUndefined();
    });

    it('should handle complex sequential cutting with length progression', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 100, length: 1, squareMeters: 1 }, // Full width, 1m
        { id: '2', width: 50, length: 1, squareMeters: 0.5 }, // Half width, next 1m
        { id: '3', width: 50, length: 1, squareMeters: 0.5 } // Other half, same position
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[1].position).toEqual({ startWidth: 0, startLength: 1 });
      expect(result[2].position).toEqual({ startWidth: 50, startLength: 1 });
      expect(result.every(p => !p.validationError)).toBe(true);
    });

    it('should detect when partition width exceeds available width', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 150, length: 1, squareMeters: 1.5 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(1);
      expect(result[0].position).toBeUndefined();
      expect(result[0].validationError).toContain('?? ??');
      expect(result[0].validationError).toContain('?? ?');
    });

    it('should detect when partition length exceeds available length', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 50, length: 6, squareMeters: 3 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(1);
      expect(result[0].position).toBeUndefined();
      expect(result[0].validationError).toContain('?? ??');
      expect(result[0].validationError).toContain('?? ?');
    });

    it('should detect when partition cannot fit in remaining space', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 100, length: 4, squareMeters: 4 }, // Uses 4m of length
        { id: '2', width: 100, length: 2, squareMeters: 2 } // Needs 2m but only 1m left
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result[0].position).toBeDefined();
      expect(result[0].validationError).toBeUndefined();
      expect(result[1].position).toBeUndefined();
      expect(result[1].validationError).toBeDefined();
    });

    it('should filter out empty partitions but preserve them in result', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 50, length: 1, squareMeters: 0.5 },
        { id: '2', width: 0, length: 0, squareMeters: 0 }, // Empty
        { id: '3', width: 50, length: 1, squareMeters: 0.5 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(3);
      expect(result[0].position).toBeDefined();
      expect(result[1].position).toBeUndefined(); // Empty partition has no position
      expect(result[2].position).toBeDefined();
    });

    it('should maintain user-defined order (no automatic sorting)', () => {
      const partitions: StonePartition[] = [
        { id: '3', width: 30, length: 1, squareMeters: 0.3 },
        { id: '1', width: 50, length: 1, squareMeters: 0.5 },
        { id: '2', width: 20, length: 1, squareMeters: 0.2 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      // Order should be preserved
      expect(result[0].id).toBe('3');
      expect(result[1].id).toBe('1');
      expect(result[2].id).toBe('2');
    });

    it('should handle edge case with zero available space', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 50, length: 1, squareMeters: 0.5 }
      ];

      const result = calculatePartitionPositions(partitions, 0, 0);

      expect(result[0].position).toBeUndefined();
      expect(result[0].validationError).toBeDefined();
    });

    it('should handle edge case with partition exactly filling remaining space', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 100, length: 5, squareMeters: 5 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[0].validationError).toBeUndefined();
    });

    it('should handle three partitions with mixed width usage', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 40, length: 1, squareMeters: 0.4 },
        { id: '2', width: 30, length: 1, squareMeters: 0.3 },
        { id: '3', width: 30, length: 1, squareMeters: 0.3 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toHaveLength(3);
      expect(result[0].position).toEqual({ startWidth: 0, startLength: 0 });
      expect(result[1].position).toEqual({ startWidth: 40, startLength: 0 });
      expect(result[2].position).toEqual({ startWidth: 70, startLength: 0 });
      expect(result.every(p => !p.validationError)).toBe(true);
    });

    it('should return original partitions array when all are empty', () => {
      const partitions: StonePartition[] = [
        { id: '1', width: 0, length: 0, squareMeters: 0 },
        { id: '2', width: 0, length: 0, squareMeters: 0 }
      ];

      const result = calculatePartitionPositions(partitions, 100, 5);

      expect(result).toEqual(partitions);
    });
  });

  describe('validatePartitionFit', () => {
    it('should validate partition that fits within bounds', () => {
      const partition: StonePartition = {
        id: '1',
        width: 50,
        length: 2,
        squareMeters: 1
      };

      const result = validatePartitionFit(partition, 100, 5);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject partition with zero dimensions', () => {
      const partition: StonePartition = {
        id: '1',
        width: 0,
        length: 0,
        squareMeters: 0
      };

      const result = validatePartitionFit(partition, 100, 5);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('??? ?? ?? ??');
    });

    it('should reject partition with excessive width', () => {
      const partition: StonePartition = {
        id: '1',
        width: 150,
        length: 2,
        squareMeters: 3
      };

      const result = validatePartitionFit(partition, 100, 5);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('?? ??');
      expect(result.error).toContain('?? ? ?? ???');
    });

    it('should reject partition with excessive length', () => {
      const partition: StonePartition = {
        id: '1',
        width: 50,
        length: 6,
        squareMeters: 3
      };

      const result = validatePartitionFit(partition, 100, 5);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('?? ??');
      expect(result.error).toContain('?? ? ?? ???');
    });

    it('should validate partition at exact bounds', () => {
      const partition: StonePartition = {
        id: '1',
        width: 100,
        length: 5,
        squareMeters: 5
      };

      const result = validatePartitionFit(partition, 100, 5);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});

