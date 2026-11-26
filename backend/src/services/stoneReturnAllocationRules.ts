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

export type FinancialAllocationSource = { financialRecordId: string; financialLineId: string };
export type AllocationSource = StoneReturnSourceKey | FinancialAllocationSource;

export type StoneReturnCandidateCapacity = (StoneReturnSourceKey & { dispatchRemainingQuantity: string }
  | FinancialAllocationSource) & {
  lineRemainingQuantity: string;
  replacementCapacity?: { ownQuantity: string; lineRemainingQuantity: string; dispatchRemainingQuantity: string };
};

export const stoneReturnSourceKey = (row: AllocationSource) => JSON.stringify('financialRecordId' in row
  ? [row.financialRecordId, row.financialLineId]
  : [row.originalInvoiceId, row.originalLineId, row.dispatchEvidenceId]);

export const stoneReturnLineKey = (invoiceId: string, lineId: string) => JSON.stringify([invoiceId, lineId]);

function allocationCapacityKeys(row: AllocationSource) {
  return 'financialRecordId' in row
    ? { lineKey: stoneReturnSourceKey(row), dispatchKey: null }
    : { lineKey: stoneReturnLineKey(row.originalInvoiceId, row.originalLineId), dispatchKey: row.dispatchEvidenceId };
}

export function stoneReturnDraftBalances<Candidate extends StoneReturnCandidateCapacity>(
  candidates: Candidate[], rows: Array<AllocationSource & { quantity: string }>,
) {
  const byKey = new Map(candidates.map(candidate => [stoneReturnSourceKey(candidate), candidate]));
  const allocatedByLine = new Map<string, bigint>();
  const allocatedByDispatch = new Map<string, bigint>();
  const unusedOwnBySource = new Map<string, bigint>();
  for (const row of rows) {
    const sourceKey = stoneReturnSourceKey(row);
    const candidate = byKey.get(sourceKey);
    if (!candidate) continue;
    const quantity = parseExactQuantityAtoms(row.quantity);
    const own = parseExactQuantityAtoms(candidate.replacementCapacity?.ownQuantity ?? '0');
    const additional = quantity > own ? quantity - own : 0n;
    const { lineKey, dispatchKey } = allocationCapacityKeys(candidate);
    allocatedByLine.set(lineKey, (allocatedByLine.get(lineKey) ?? 0n) + additional);
    if (dispatchKey) allocatedByDispatch.set(dispatchKey, (allocatedByDispatch.get(dispatchKey) ?? 0n) + additional);
    unusedOwnBySource.set(sourceKey, own > quantity ? own - quantity : 0n);
  }
  return candidates.map(candidate => {
    const replacement = candidate.replacementCapacity;
    const { lineKey } = allocationCapacityKeys(candidate);
    const line = parseExactQuantityAtoms(replacement?.lineRemainingQuantity ?? candidate.lineRemainingQuantity)
      - (allocatedByLine.get(lineKey) ?? 0n);
    const dispatch = 'financialRecordId' in candidate ? line
      : parseExactQuantityAtoms(replacement?.dispatchRemainingQuantity ?? candidate.dispatchRemainingQuantity)
        - (allocatedByDispatch.get(candidate.dispatchEvidenceId) ?? 0n);
    const own = unusedOwnBySource.get(stoneReturnSourceKey(candidate)) ?? parseExactQuantityAtoms(replacement?.ownQuantity ?? '0');
    const remainder = own + (line < dispatch ? line : dispatch);
    return { ...candidate, draftRemainingQuantity: formatExactQuantityAtoms(remainder > 0n ? remainder : 0n) };
  });
}

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
  rows: Array<AllocationSource & { quantity: string }>,
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
    const financial = 'financialRecordId' in candidate;
    if (usedKeys.has(key)) throw new StoneReturnAllocationError(400, financial
      ? 'هر مرجع فروش را یک بار تخصیص دهید.' : 'هر ردیف فروش و بارگیری را یک بار تخصیص دهید.');
    usedKeys.add(key);
    const quantity = allocationQuantity(row.quantity, receipt.unit);
    total += quantity;

    const replacement = candidate.replacementCapacity;
    const ownQuantity = replacement ? parseExactQuantityAtoms(replacement.ownQuantity) : 0n;
    const additional = quantity > ownQuantity ? quantity - ownQuantity : 0n;
    const { lineKey, dispatchKey } = allocationCapacityKeys(candidate);
    const lineTotal = (lineQuantities.get(lineKey) ?? 0n) + additional;
    const dispatchTotal = dispatchKey ? (dispatchQuantities.get(dispatchKey) ?? 0n) + additional : 0n;
    if (lineTotal > parseExactQuantityAtoms(replacement?.lineRemainingQuantity ?? candidate.lineRemainingQuantity)
      || (!financial && dispatchTotal > parseExactQuantityAtoms(replacement?.dispatchRemainingQuantity ?? candidate.dispatchRemainingQuantity))) {
      throw new StoneReturnAllocationError(409, financial
        ? 'مقدار تخصیص از مانده قابل برگشت ردیف مالی بیشتر است.'
        : 'مقدار تخصیص از مانده قابل برگشت ردیف فروش یا بارگیری بیشتر است.');
    }
    lineQuantities.set(lineKey, lineTotal);
    if (dispatchKey) dispatchQuantities.set(dispatchKey, dispatchTotal);
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
