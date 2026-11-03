export type StatementCorrectionKind = 'QUANTITY' | 'RETURN' | 'REATTRIBUTION' | 'REVERSAL';

export type StatementCorrectionPolicyCode =
  | 'INVALID_QUANTITY'
  | 'UNKNOWN_STABLE_ROW'
  | 'DUPLICATE_STABLE_ROW'
  | 'AMBIGUOUS_MIXED_SIGN'
  | 'REATTRIBUTION_SEMANTICS_MISMATCH';

export class StatementCorrectionPolicyError extends Error {
  constructor(public readonly code: StatementCorrectionPolicyCode, message: string) {
    super(message);
  }
}

export type StatementCorrectionScopeRow = {
  contractId: string;
  contractItemId: string;
  productRowId: string;
  unit: string;
  pricingVersionId: string;
};

type RequestedLine = { contractItemId: string; quantity: string | number; returnEvidenceId?: string };
type RequestedReattribution = { sourceContractItemId: string; destinationContractItemId: string; quantity: string | number };

const quantityAtoms = (value: string | number, positiveOnly = false) => {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) throw new StatementCorrectionPolicyError('INVALID_QUANTITY', 'Correction quantity must use canonical scale three.');
  const atoms = BigInt(match[2]) * 1000n + BigInt((match[3] || '').padEnd(3, '0'));
  const signed = match[1] ? -atoms : atoms;
  if (signed === 0n || (positiveOnly && signed < 0n)) {
    throw new StatementCorrectionPolicyError('INVALID_QUANTITY', 'Correction quantity must be non-zero and use the required direction.');
  }
  return signed;
};
const quantity = (atoms: bigint) => `${atoms < 0n ? '-' : ''}${(atoms < 0n ? -atoms : atoms) / 1000n}.${String((atoms < 0n ? -atoms : atoms) % 1000n).padStart(3, '0')}`;

export const normalizeDispatchCorrectionDraft = (input: {
  lines?: RequestedLine[];
  reattributions?: RequestedReattribution[];
  reversalOfId?: string;
}, scope: StatementCorrectionScopeRow[]): {
  kind: StatementCorrectionKind;
  lines: Array<StatementCorrectionScopeRow & { quantity: string; returnEvidenceId: string | null }>;
  reattributions: Array<{ sourceContractItemId: string; destinationContractItemId: string;
    quantity: string; unit: string; pricingVersionId: string }>;
} => {
  const rows = new Map(scope.map((row) => [row.contractItemId, row]));
  const resolve = (contractItemId: string) => {
    const row = rows.get(String(contractItemId || '').trim());
    if (!row) throw new StatementCorrectionPolicyError('UNKNOWN_STABLE_ROW', 'Correction row is outside the frozen statement scope.');
    return row;
  };
  if (input.reattributions?.length) {
    if (input.lines?.length || input.reversalOfId) {
      throw new StatementCorrectionPolicyError('AMBIGUOUS_MIXED_SIGN', 'Row reattribution must be submitted only as explicit source-to-destination pairs.');
    }
    const used = new Set<string>();
    const reattributions = input.reattributions.map((pair) => {
      const source = resolve(pair.sourceContractItemId);
      const destination = resolve(pair.destinationContractItemId);
      const atoms = quantityAtoms(pair.quantity, true);
      if (source.contractItemId === destination.contractItemId || source.unit !== destination.unit
        || source.pricingVersionId !== destination.pricingVersionId) {
        throw new StatementCorrectionPolicyError('REATTRIBUTION_SEMANTICS_MISMATCH', 'Reattribution requires distinct rows with the same unit and frozen pricing version.');
      }
      if (used.has(source.contractItemId) || used.has(destination.contractItemId)) {
        throw new StatementCorrectionPolicyError('DUPLICATE_STABLE_ROW', 'A stable row may participate in only one reattribution pair.');
      }
      used.add(source.contractItemId);
      used.add(destination.contractItemId);
      return { source, destination, quantity: quantity(atoms), unit: source.unit, pricingVersionId: source.pricingVersionId };
    });
    return {
      kind: 'REATTRIBUTION',
      lines: reattributions.flatMap((pair) => [
        { ...pair.source, quantity: `-${pair.quantity}`, returnEvidenceId: null },
        { ...pair.destination, quantity: pair.quantity, returnEvidenceId: null },
      ]),
      reattributions: reattributions.map(({ source, destination, ...pair }) => ({
        sourceContractItemId: source.contractItemId, destinationContractItemId: destination.contractItemId, ...pair,
      })),
    };
  }
  if (!input.lines?.length) throw new StatementCorrectionPolicyError('INVALID_QUANTITY', 'At least one correction line is required.');
  const used = new Set<string>();
  const lines = input.lines.map((line) => {
    const row = resolve(line.contractItemId);
    if (used.has(row.contractItemId)) throw new StatementCorrectionPolicyError('DUPLICATE_STABLE_ROW', 'A correction may contain each stable row only once.');
    used.add(row.contractItemId);
    return { ...row, quantity: quantity(quantityAtoms(line.quantity)), returnEvidenceId: line.returnEvidenceId?.trim() || null };
  });
  const hasPositive = lines.some((line) => !line.quantity.startsWith('-'));
  const hasNegative = lines.some((line) => line.quantity.startsWith('-'));
  if (hasPositive && hasNegative) {
    throw new StatementCorrectionPolicyError('AMBIGUOUS_MIXED_SIGN', 'Mixed-sign corrections require explicit source-to-destination reattribution pairs.');
  }
  return { kind: input.reversalOfId ? 'REVERSAL' : hasNegative ? 'RETURN' : 'QUANTITY', lines, reattributions: [] };
};
