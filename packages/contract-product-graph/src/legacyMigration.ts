import Decimal from 'decimal.js';
import { hashCanonicalValue } from './canonicalHash';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { readLegacyProductGraph, type LegacyProductGraphInput, type LegacyProductGraphConflict } from './legacyReadAdapter';
import type { CanonicalProductGraph } from './productGraph';
import {
  deriveLegacyProductSemanticRepairCandidates,
  type LegacyProductSemanticRepairEvidence
} from './legacySemanticRepair';

export interface LegacyMigrationReconciliation {
  readonly legacyTotalAmountToman: CanonicalDecimal;
  readonly canonicalTotalAmountToman: CanonicalDecimal;
  readonly differenceToman: CanonicalDecimal;
  readonly matches: boolean;
}

export type LegacyMigrationPlan =
  | {
      readonly ok: true;
      readonly graph: CanonicalProductGraph;
      readonly reconciliation: LegacyMigrationReconciliation;
      readonly provenanceHash: string;
      readonly semanticRepairEvidence?: readonly LegacyProductSemanticRepairEvidence[];
    }
  | {
      readonly ok: false;
      readonly conflicts: readonly (LegacyProductGraphConflict | {
        readonly code: 'legacy-financial-drift';
        readonly path: readonly string[];
        readonly message: string;
        readonly productRowId?: string;
      })[];
      readonly reconciliation?: LegacyMigrationReconciliation;
      readonly semanticRepairEvidence?: readonly LegacyProductSemanticRepairEvidence[];
    };

const money = (value: unknown): Decimal => {
  const parsed = new Decimal(String(value ?? '0'));
  return parsed.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
};

export const repairRecoverableLegacyProductSemantics = (
  input: LegacyProductGraphInput
): {
  readonly products: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly LegacyProductSemanticRepairEvidence[];
} => {
  let products = [...input.products];
  const evidence: LegacyProductSemanticRepairEvidence[] = [];
  const candidates = deriveLegacyProductSemanticRepairCandidates(products);

  candidates.forEach(candidate => {
    const nextProducts = products.map((product, index) =>
      index === candidate.productIndex ? candidate.product : product
    );
    const read = readLegacyProductGraph({ ...input, products: nextProducts });
    if (!read.ok) return;
    const row = read.graph.rows.find(
      graphRow => graphRow.productRowId === candidate.productRowId
    );
    if (!row) return;
    const legacyTotal = money(candidate.product.totalPrice);
    const canonicalTotal = money(row.commercial.totalAmountToman);
    if (!canonicalTotal.eq(legacyTotal)) return;

    products = nextProducts;
    evidence.push({
      productRowId: candidate.productRowId,
      repairKinds: candidate.repairKinds,
      repairedFields: candidate.repairedFields,
      legacyTotalAmountToman: legacyTotal.toFixed(),
      canonicalTotalAmountToman: canonicalTotal.toFixed()
    });
  });

  return { products, evidence };
};

export const planLegacyProductGraphMigration = (
  input: LegacyProductGraphInput,
  expectedLegacyTotalAmountToman?: unknown
): LegacyMigrationPlan => {
  const semanticRepair = repairRecoverableLegacyProductSemantics(input);
  const normalizedInput = {
    ...input,
    products: semanticRepair.products
  };
  const read = readLegacyProductGraph(normalizedInput);
  if (!read.ok) {
    return {
      ok: false,
      conflicts: read.conflicts,
      ...(semanticRepair.evidence.length
        ? { semanticRepairEvidence: semanticRepair.evidence }
        : {})
    };
  }

  const productTotal = normalizedInput.products.reduce(
    (sum, product) => sum.plus(money(product.totalPrice)),
    new Decimal(0)
  );
  const legacyTotal = expectedLegacyTotalAmountToman === undefined
    ? productTotal
    : money(expectedLegacyTotalAmountToman);
  const canonicalTotal = read.graph.rows.reduce(
    (sum, row) => sum.plus(money(row.commercial.totalAmountToman)),
    new Decimal(0)
  );
  const difference = canonicalTotal.minus(legacyTotal);
  const reconciliation: LegacyMigrationReconciliation = {
    legacyTotalAmountToman: parseCanonicalDecimal(legacyTotal.toFixed()),
    canonicalTotalAmountToman: parseCanonicalDecimal(canonicalTotal.toFixed()),
    differenceToman: parseCanonicalDecimal(difference.toFixed()),
    matches: difference.isZero()
  };
  if (!reconciliation.matches) {
    const rowById = new Map<string, CanonicalProductGraph['rows'][number]>(
      read.graph.rows.map(row => [String(row.productRowId), row])
    );
    const rowConflicts = normalizedInput.products.flatMap((product, index) => {
      const productRowId = String(
        product.rowId ?? product.productRowId ?? `legacy:${input.contractId}:product:${index}`
      );
      const row = rowById.get(productRowId);
      if (!row) return [];
      const difference = money(row.commercial.totalAmountToman)
        .minus(money(product.totalPrice));
      if (difference.isZero()) return [];
      return [{
        code: 'legacy-financial-drift' as const,
        path: ['products', String(index), 'totalAmount'],
        productRowId,
        message:
          `Legacy and canonical product totals differ by ${difference.toFixed()} toman.`
      }];
    });
    return {
      ok: false,
      reconciliation,
      conflicts: rowConflicts.length > 0
        ? rowConflicts
        : [{
            code: 'legacy-financial-drift',
            path: ['totalAmount'],
            message: `Legacy and canonical totals differ by ${difference.toFixed()} toman.`
          }],
      ...(semanticRepair.evidence.length
        ? { semanticRepairEvidence: semanticRepair.evidence }
        : {})
    };
  }
  return {
    ok: true,
    graph: read.graph,
    reconciliation,
    provenanceHash: hashCanonicalValue({
      contractId: input.contractId,
      revision: input.revision,
      products: normalizedInput.products,
      reconciliation
    }),
    ...(semanticRepair.evidence.length
      ? { semanticRepairEvidence: semanticRepair.evidence }
      : {})
  };
};
