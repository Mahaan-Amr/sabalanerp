import { HashSchema, partnerError, type PartnerErrorCode, type Result } from '@sabalanerp/partner-sales-contracts';
import {
  formatShipmentQuantity,
  parseShipmentQuantityToScaledInteger,
} from '../../shipmentQuantityProjection';

export type CorrectionQuantity = {
  productRowId: string;
  quantity: string;
  unit: string;
};

export type CorrectionPhysicalRow = {
  productRowId: string;
  reserved: string;
  dispatched: string;
  unit: string;
  health: 'CURRENT' | 'STALE' | 'LEGACY_UNRECONCILED' | 'EVIDENCE_CONFLICT';
};

export type RemainingChildEvidence = {
  childId: string;
  productRowId: string;
  evidenceHash: string;
};

export type PartnerCorrectionDependencyInput = {
  predecessorProducts: CorrectionQuantity[];
  successorProducts: CorrectionQuantity[];
  physical: { evidenceIds: string[]; rows: CorrectionPhysicalRow[] };
  financial: { evidenceIds: string[]; receiptStateHash: string; health: 'CURRENT' | 'STALE' | 'EVIDENCE_CONFLICT' };
  suppliedEvidenceIds: string[];
  predecessorChildren: RemainingChildEvidence[];
  successorChildren: RemainingChildEvidence[];
};

export type PartnerCorrectionDependencyEvidence = {
  evidenceIds: string[];
  childReplay: RemainingChildEvidence[];
  floors: Array<{ productRowId: string; quantity: string; unit: string }>;
};

const failure = (code: PartnerErrorCode): Result<PartnerCorrectionDependencyEvidence> => ({
  ok: false,
  error: partnerError(code),
});

const unique = <T>(values: T[]) => new Set(values).size === values.length;
const sortedUnique = (values: string[]) => [...new Set(values)].sort();

function scaled(value: string): bigint | null {
  try {
    return parseShipmentQuantityToScaledInteger(value);
  } catch {
    return null;
  }
}

/**
 * Reconciles correction evidence without deriving facts owned by Logistics.
 * Exact fixed-point quantities are used; presentation tolerance never enters
 * the correction floor or persisted evidence.
 */
export function validatePartnerCorrectionDependencies(
  input: PartnerCorrectionDependencyInput,
): Result<PartnerCorrectionDependencyEvidence> {
  const predecessorIds = input.predecessorProducts.map(row => row.productRowId);
  const successorIds = input.successorProducts.map(row => row.productRowId);
  const physicalIds = input.physical.rows.map(row => row.productRowId);
  const predecessorChildIds = input.predecessorChildren.map(row => row.childId);
  const successorChildIds = input.successorChildren.map(row => row.childId);
  if (!unique(predecessorIds) || !unique(successorIds) || !unique(physicalIds) ||
      !unique(predecessorChildIds) || !unique(successorChildIds)) return failure('INTEGRITY_CONFLICT');

  const physicalEvidence = sortedUnique(input.physical.evidenceIds);
  const financialEvidence = sortedUnique(input.financial.evidenceIds);
  const expectedEvidence = sortedUnique([...physicalEvidence, ...financialEvidence]);
  const suppliedEvidence = sortedUnique(input.suppliedEvidenceIds);
  if (!physicalEvidence.length || !financialEvidence.length || input.financial.health !== 'CURRENT' ||
      !HashSchema.safeParse(input.financial.receiptStateHash).success ||
      physicalEvidence.length !== input.physical.evidenceIds.length ||
      financialEvidence.length !== input.financial.evidenceIds.length ||
      expectedEvidence.length !== input.physical.evidenceIds.length + input.financial.evidenceIds.length ||
      suppliedEvidence.length !== input.suppliedEvidenceIds.length ||
      expectedEvidence.length !== suppliedEvidence.length ||
      expectedEvidence.some((id, index) => id !== suppliedEvidence[index])) return failure('DEPENDENCY_BLOCKED');

  const successors = new Map(input.successorProducts.map(row => [row.productRowId, row]));
  const physical = new Map(input.physical.rows.map(row => [row.productRowId, row]));
  const floors: PartnerCorrectionDependencyEvidence['floors'] = [];
  for (const predecessor of input.predecessorProducts) {
    const next = successors.get(predecessor.productRowId);
    const evidence = physical.get(predecessor.productRowId);
    if (!evidence || evidence.health !== 'CURRENT' || evidence.unit !== predecessor.unit ||
        (next && next.unit !== predecessor.unit)) return failure('DEPENDENCY_BLOCKED');
    const reserved = scaled(evidence.reserved);
    const dispatched = scaled(evidence.dispatched);
    const previous = scaled(predecessor.quantity);
    const proposed = scaled(next?.quantity ?? '0');
    if (reserved === null || dispatched === null || previous === null || proposed === null ||
        reserved < 0n || dispatched < 0n || previous <= 0n || proposed < reserved + dispatched ||
        reserved + dispatched > previous) return failure('DEPENDENCY_BLOCKED');
    floors.push({ productRowId: predecessor.productRowId,
      quantity: formatShipmentQuantity(reserved + dispatched), unit: predecessor.unit });
  }
  if (input.physical.rows.some(row => !predecessorIds.includes(row.productRowId)) ||
      input.successorProducts.some(row => scaled(row.quantity) === null || scaled(row.quantity)! <= 0n)) {
    return failure('INTEGRITY_CONFLICT');
  }

  const predecessorChildren = new Map(input.predecessorChildren.map(child => [child.childId, child]));
  if (predecessorChildren.size !== input.successorChildren.length || input.successorChildren.some(child => {
    const previous = predecessorChildren.get(child.childId);
    return !previous || previous.productRowId !== child.productRowId || previous.evidenceHash !== child.evidenceHash ||
      !successors.has(child.productRowId);
  })) return failure('INTEGRITY_CONFLICT');

  return { ok: true, value: {
    evidenceIds: expectedEvidence,
    childReplay: [...input.successorChildren].sort((left, right) => left.childId.localeCompare(right.childId)),
    floors: floors.sort((left, right) => left.productRowId.localeCompare(right.productRowId)),
  } };
}
