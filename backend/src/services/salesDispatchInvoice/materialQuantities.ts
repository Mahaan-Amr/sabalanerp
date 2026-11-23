import { Prisma } from '@prisma/client';
import { parsePrintNumber, printDigits } from '../../documents/dispatch/dispatchPrintLayout';
import type { DispatchProductPrintRow } from '../../utils/printTemplate';
import type { AllocationQuantityBasis } from '../allocationPricingReadModel';

const Decimal = Prisma.Decimal.clone({ precision: 100 });
const positive = (value: unknown) => {
  try { const number = new Decimal(String(value)); return number.isFinite() && number.gt(0) ? number : undefined; }
  catch { return undefined; }
};
const display = (value: InstanceType<typeof Decimal>) => printDigits(value.toDecimalPlaces(4).toFixed().replace('.', '٫'));
const unknown = (row: DispatchProductPrintRow) => ({ ...row, count: '—', linearMeasurement: row.linearMeasurement ? '—' : '', squareMeasurement: row.squareMeasurement ? '—' : '' });

/** Shipment material is presentation evidence only: retain every recorded monetary cell.
 * Cumulative source-piece deltas consume a mother piece once even when its output
 * is divided between successive shipments or drivers. No source ordering is inferred.
 */
export function projectLoadedMaterialRows(
  rows: DispatchProductPrintRow[], product: any,
  loaded: { quantity: string; unit: string }, basis?: AllocationQuantityBasis,
): DispatchProductPrintRow[] {
  const material = rows.filter(row => row.category === 'سنگ مصرفی');
  if (!material.length) return rows;
  const contracted = positive(basis?.contractedQuantity ?? (
    ['count', 'piece', 'number', 'عدد'].includes(loaded.unit) ? product.quantity
      : ['m2', 'squareMeter', 'متر مربع'].includes(loaded.unit) ? product.squareMeters
        : ['m', 'meter', 'متر طول'].includes(loaded.unit) ? product.linearMeters : undefined));
  const shipped = positive(loaded.quantity);
  if (!contracted || !shipped) return rows.map(row => row.category === 'سنگ مصرفی' ? unknown(row) : row);
  let before = new Decimal(0), after = shipped;
  try {
    if (basis) { before = new Decimal(basis.beforeQuantity); after = new Decimal(basis.afterQuantity); }
  } catch { return rows.map(row => row.category === 'سنگ مصرفی' ? unknown(row) : row); }
  if (!before.isFinite() || !after.isFinite() || before.lt(0) || after.gt(contracted) || !after.minus(before).eq(shipped))
    return rows.map(row => row.category === 'سنگ مصرفی' ? unknown(row) : row);
  if (shipped.eq(contracted)) return rows;
  const sourceCount = material.length === 1 ? parsePrintNumber(material[0].count) : null;
  const stair = product.meta?.stair;
  const yieldCount = positive(stair?.piecesPerStone);
  const finishedCount = positive(product.quantity);
  let consumed: InstanceType<typeof Decimal> | undefined;
  // Use recorded yield, never finished-piece count as mother-piece count. The
  // contract's rounded source count must corroborate the recorded yield.
  if (basis && sourceCount && yieldCount?.isInteger() && finishedCount?.isInteger()
      && finishedCount.div(yieldCount).ceil().eq(sourceCount)) {
    const beforePieces = before.mul(finishedCount).div(contracted);
    const afterPieces = after.mul(finishedCount).div(contracted);
    if (beforePieces.isInteger() && afterPieces.isInteger())
      consumed = afterPieces.div(yieldCount).ceil().minus(beforePieces.div(yieldCount).ceil());
  }
  const ratio = shipped.div(contracted);
  return rows.map(row => {
    if (row.category !== 'سنگ مصرفی') return row;
    // Different physical sources have no implied attribution to this cargo.
    if (material.length !== 1) return unknown(row);
    const count = parsePrintNumber(row.count);
    const area = parsePrintNumber(row.squareMeasurement);
    const linear = parsePrintNumber(row.linearMeasurement);
    const exactCount = count?.mul(ratio);
    const physicalCount = consumed ?? (exactCount?.isInteger() ? exactCount : undefined);
    const sourceRatio = consumed && count?.gt(0) ? consumed.div(count) : ratio;
    return { ...row, count: physicalCount ? display(physicalCount) : '—',
      linearMeasurement: linear ? display(linear.mul(sourceRatio)) : row.linearMeasurement,
      squareMeasurement: area ? display(area.mul(sourceRatio)) : row.squareMeasurement };
  });
}
