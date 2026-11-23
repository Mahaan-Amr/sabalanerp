import { Prisma } from '@prisma/client';
import { parsePrintNumber, printDigits } from '../../documents/dispatch/dispatchPrintLayout';
import type { DispatchProductPrintRow } from '../../utils/printTemplate';

const Decimal = Prisma.Decimal.clone({ precision: 100 });
export type ServiceQuantityBasis = {
  contractedQuantity: string;
  beforeQuantity: string;
  afterQuantity: string;
};
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};
const quantityCells = ['count', 'linearMeasurement', 'squareMeasurement'] as const;
const serviceCategories = new Set(['ابزار', 'برش', 'پرداخت سنگ', 'خدمات', 'لایه', 'ابعاد لایه']);

function readable(value: InstanceType<typeof Decimal>) {
  const [whole, fraction] = value.toFixed().split('.');
  return printDigits(whole.replace(/\B(?=(\d{3})+(?!\d))/g, '٬')) + (fraction ? `٫${printDigits(fraction)}` : '');
}

/** Project saved billing quantities, never recalculate a contract charge or use
 * catalog rates. The verified cumulative allocation interval makes rounded
 * shares additive across drivers, later shipments and the final remainder.
 * Minimum billed quantities belong to the approved contract operation; applying
 * a new minimum to each vehicle would invent a second charge.
 */
export function projectLoadedServiceRows(
  rows: DispatchProductPrintRow[],
  product: unknown,
  basis?: ServiceQuantityBasis,
): DispatchProductPrintRow[] {
  const saved = object(product);
  const length = saved.length ?? saved.lengthMeters ?? saved.actualLengthMeters ?? saved.requestedLengthMeters;
  const width = saved.width ?? saved.widthMeters ?? saved.requestedWidthMeters;
  // Fixed geometry proves that the same saved service basis applies to each
  // finished piece. A mixed-size row needs shipment-specific operation evidence.
  const uniformGeometry = Number(length) > 0 && Number(width) > 0
    && !Array.isArray(saved.dimensions) && !Array.isArray(saved.pieces);
  let interval: { before: InstanceType<typeof Decimal>; after: InstanceType<typeof Decimal>; total: InstanceType<typeof Decimal> } | undefined;
  if (basis) {
    try {
      const total = new Decimal(basis.contractedQuantity), before = new Decimal(basis.beforeQuantity), after = new Decimal(basis.afterQuantity);
      if (total.isFinite() && before.isFinite() && after.isFinite() && total.gt(0) && before.gte(0) && after.gte(before) && after.lte(total)
          && (uniformGeometry || (before.isZero() && after.eq(total)))) interval = { total, before, after };
    } catch { /* Incomplete historical facts remain visibly unavailable. */ }
  }
  let layer = false;
  return rows.map((row, index) => {
    if (index === 0) return row;
    if (row.category === 'لایه' || /^(?:↳\s*)?لایه(?:\s|$)/.test(row.description)) layer = true;
    const isService = serviceCategories.has(row.category) || (layer && row.category !== 'سنگ مصرفی' && row.category !== 'حکمی' && row.category !== 'توضیحات');
    if (!isService) return row;
    const projected = { ...row };
    for (const cell of quantityCells) {
      if (!row[cell] || row[cell] === '—') continue;
      const numericText = cell === 'count' ? row[cell].match(/^[۰-۹٠-٩0-9٬,٫.]+/)?.[0] : row[cell];
      const quantity = numericText ? parsePrintNumber(numericText) : undefined;
      if (!quantity || !interval) {
        projected[cell] = '—';
        continue;
      }
      const cumulative = (value: InstanceType<typeof Decimal>) => quantity.mul(value).div(interval.total).toDecimalPlaces(4);
      const share = cumulative(interval.after).minus(cumulative(interval.before));
      // Retain recorded count units such as نوار and ست.
      const suffix = cell === 'count' ? row[cell].replace(/[۰-۹٠-٩0-9٬,٫.\s+-]/g, '') : '';
      projected[cell] = readable(share) + (suffix ? ` ${suffix}` : '');
    }
    return projected;
  });
}
