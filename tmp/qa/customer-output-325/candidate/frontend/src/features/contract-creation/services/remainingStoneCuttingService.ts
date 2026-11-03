import type { CuttingBreakdownEntry, RemainingStone, StonePartition } from '../types/contract.types';

const normalizeCalculatedNumber = (value: number): number => Number(value.toFixed(6));

export const calculateRemainingChildCuttingBreakdown = ({
  row,
  stock,
  rate
}: {
  row: StonePartition;
  stock: RemainingStone;
  rate: number;
}): CuttingBreakdownEntry[] => {
  const safeRate = Math.max(0, Number(rate) || 0);
  const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1));
  const breakdown: CuttingBreakdownEntry[] = [];

  if (row.width < stock.width) {
    const meters = normalizeCalculatedNumber(Number(row.length || 0) * quantity);
    breakdown.push({ type: 'longitudinal', meters, rate: safeRate, cost: normalizeCalculatedNumber(meters * safeRate) });
  }

  if (row.length < stock.length) {
    const meters = normalizeCalculatedNumber((Number(row.width || 0) / 100) * quantity);
    breakdown.push({ type: 'cross', meters, rate: safeRate, cost: normalizeCalculatedNumber(meters * safeRate) });
  }

  return breakdown;
};
