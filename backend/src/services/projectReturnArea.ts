import { EXACT_QUANTITY_SCALE, ExactQuantityDecimal, parseExactQuantityAtoms } from './exactQuantity';

export function projectReturnWidth(value: unknown, unit: unknown): string | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || (unit !== 'm' && unit !== 'cm')) return null;
  try {
    const width = new ExactQuantityDecimal(value);
    if (!width.isFinite() || !width.gt(0)) return null;
    const converted = unit === 'cm' ? width.div(100) : width;
    if (converted.gte('1e35') || converted.lt('1e-30')) return null;
    const meters = converted.toFixed();
    parseExactQuantityAtoms(meters);
    return meters;
  } catch {
    return null;
  }
}

export function projectReturnItemArea(
  item: { unit: string; healthyQuantity: string; damagedQuantity: string },
  effectiveWidthMeters: string | null,
) {
  const area = (quantity: string) => {
    if (item.unit === 'squareMeter') return quantity;
    if (item.unit !== 'meter' || effectiveWidthMeters === null) return null;
    const value = new ExactQuantityDecimal(quantity).mul(effectiveWidthMeters)
      .toDecimalPlaces(EXACT_QUANTITY_SCALE, ExactQuantityDecimal.ROUND_HALF_UP).toFixed();
    parseExactQuantityAtoms(value);
    return value;
  };
  return {
    effectiveWidthMeters,
    healthyAreaSquareMeters: area(item.healthyQuantity),
    damagedAreaSquareMeters: area(item.damagedQuantity),
  };
}
