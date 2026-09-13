import type { CuttingBreakdownEntry, RemainingStone, StonePartition } from '../types/contract.types';
import {
  calculatePackingPlan,
  packPreservedSourceDistribution,
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';

const normalizeCalculatedNumber = (value: number): number => Number(value.toFixed(6));

export const calculateRemainingChildCuttingBreakdown = ({
  row,
  stock,
  rate,
  sourcePieceQuantities,
  sawKerfCm = 0
}: {
  row: StonePartition;
  stock: RemainingStone;
  rate: number;
  sourcePieceQuantities?: number[];
  sawKerfCm?: number;
}): CuttingBreakdownEntry[] | undefined => {
  const safeRate = Math.max(0, Number(rate) || 0);
  const request = {
    policyVersion: 'packing-v1',
    kerfMeters: parseCanonicalDecimal(String(Math.max(0, Number(sawKerfCm) || 0) / 100)),
    sources: [{
      sourceBatchId: parseStableIdentity('source-batch', `remaining-cut-preview:${stock.id}`),
      lengthMeters: parseCanonicalDecimal(String(stock.length)),
      widthMeters: parseCanonicalDecimal(String(stock.width / 100)),
      quantity: Math.max(1, Math.floor(Number(stock.quantity) || 1))
    }],
    demands: [{
      demandId: row.id,
      lengthMeters: parseCanonicalDecimal(String(row.length)),
      widthMeters: parseCanonicalDecimal(String(row.width / 100)),
      quantity: Math.max(1, Math.floor(Number(row.quantity) || 1))
    }]
  };
  const packed = sourcePieceQuantities
    ? packPreservedSourceDistribution(request, sourcePieceQuantities)
    : calculatePackingPlan(request);
  if (!packed.ok) return undefined;

  return ([
    ['longitudinal', packed.plan.longitudinalCutMeters],
    ['cross', packed.plan.crossCutMeters]
  ] as const).flatMap(([type, canonicalMeters]) => {
    const meters = normalizeCalculatedNumber(Number(canonicalMeters));
    return meters > 0
      ? [{ type, meters, rate: safeRate, cost: normalizeCalculatedNumber(meters * safeRate) }]
      : [];
  });
};
