import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';

export class StoneReturnAllocationError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export type StoneReturnSourceKey = {
  originalInvoiceId: string;
  originalLineId: string;
  dispatchEvidenceId: string;
};

export type StoneReturnAllocationInput = StoneReturnSourceKey & { quantity: string };

export type StoneReturnCandidateCapacity = StoneReturnSourceKey & {
  lineRemainingQuantity: string;
  dispatchRemainingQuantity: string;
};

export const stoneReturnSourceKey = (row: StoneReturnSourceKey) => JSON.stringify([
  row.originalInvoiceId, row.originalLineId, row.dispatchEvidenceId,
]);

export const stoneReturnLineKey = (invoiceId: string, lineId: string) => JSON.stringify([invoiceId, lineId]);

function allocationQuantity(value: unknown, unit: string) {
  try {
    if (typeof value !== 'string' || value.length > 100) throw new Error();
    const quantity = parseExactQuantityAtoms(value);
    if (quantity <= 0n || (unit === 'count' && !formatExactQuantityAtoms(quantity).endsWith('.000'))) throw new Error();
    return quantity;
  } catch {
    throw new StoneReturnAllocationError(400, 'مقدار تخصیص باید مثبت و در واحد عدد، صحیح باشد.');
  }
}

export function validateStoneReturnAllocations<Candidate extends StoneReturnCandidateCapacity>(
  receipt: { acceptedQuantity: string; unit: string },
  available: { candidates: Candidate[] },
  rows: StoneReturnAllocationInput[],
  rawReason: unknown,
  requireComplete = false,
) {
  const attributionReason = typeof rawReason === 'string' ? rawReason.trim() || null : null;
  if ((rawReason != null && typeof rawReason !== 'string') || (attributionReason && attributionReason.length > 2000)) {
    throw new StoneReturnAllocationError(400, 'دلیل تخصیص معتبر نیست.');
  }

  const byKey = new Map(available.candidates.map(row => [stoneReturnSourceKey(row), row]));
  const usedKeys = new Set<string>();
  const lineQuantities = new Map<string, bigint>();
  const dispatchQuantities = new Map<string, bigint>();
  let total = 0n;
  const validated = rows.map(row => {
    const key = stoneReturnSourceKey(row);
    const candidate = byKey.get(key);
    if (!candidate) throw new StoneReturnAllocationError(409, 'یکی از ردیف‌ها برای تخصیص این مرجوعی قابل استفاده نیست.');
    if (usedKeys.has(key)) throw new StoneReturnAllocationError(400, 'هر ردیف فروش و بارگیری را یک بار تخصیص دهید.');
    usedKeys.add(key);
    const quantity = allocationQuantity(row.quantity, receipt.unit);
    total += quantity;

    const lineKey = stoneReturnLineKey(row.originalInvoiceId, row.originalLineId);
    const lineTotal = (lineQuantities.get(lineKey) ?? 0n) + quantity;
    const dispatchTotal = (dispatchQuantities.get(row.dispatchEvidenceId) ?? 0n) + quantity;
    if (lineTotal > parseExactQuantityAtoms(candidate.lineRemainingQuantity)
      || dispatchTotal > parseExactQuantityAtoms(candidate.dispatchRemainingQuantity)) {
      throw new StoneReturnAllocationError(409, 'مقدار تخصیص از مانده قابل برگشت ردیف فروش یا بارگیری بیشتر است.');
    }
    lineQuantities.set(lineKey, lineTotal);
    dispatchQuantities.set(row.dispatchEvidenceId, dispatchTotal);
    return { candidate, quantity: formatExactQuantityAtoms(quantity) };
  });

  const accepted = parseExactQuantityAtoms(receipt.acceptedQuantity);
  if (total > accepted || (requireComplete && (total !== accepted || total === 0n))) {
    throw new StoneReturnAllocationError(409, 'تخصیص باید در محدوده مقدار پذیرفته‌شده باشد و برای ثبت قطعی آن را کامل پوشش دهد.');
  }

  return {
    rows: validated,
    attributionReason,
    allocatedQuantity: formatExactQuantityAtoms(total),
    unallocatedQuantity: formatExactQuantityAtoms(accepted - total),
  };
}
