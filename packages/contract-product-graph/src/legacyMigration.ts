import Decimal from 'decimal.js';
import { hashCanonicalValue } from './canonicalHash';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { readLegacyProductGraph, type LegacyProductGraphInput, type LegacyProductGraphConflict } from './legacyReadAdapter';
import type { CanonicalProductGraph } from './productGraph';

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
    }
  | {
      readonly ok: false;
      readonly conflicts: readonly (LegacyProductGraphConflict | {
        readonly code: 'legacy-financial-drift';
        readonly path: readonly string[];
        readonly message: string;
      })[];
      readonly reconciliation?: LegacyMigrationReconciliation;
    };

const money = (value: unknown): Decimal => {
  const parsed = new Decimal(String(value ?? '0'));
  return parsed.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
};

export const planLegacyProductGraphMigration = (
  input: LegacyProductGraphInput,
  expectedLegacyTotalAmountToman?: unknown
): LegacyMigrationPlan => {
  const read = readLegacyProductGraph(input);
  if (!read.ok) return { ok: false, conflicts: read.conflicts };

  const productTotal = input.products.reduce(
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
    return {
      ok: false,
      reconciliation,
      conflicts: [{
        code: 'legacy-financial-drift',
        path: ['totalAmount'],
        message: `Legacy and canonical totals differ by ${difference.toFixed()} toman.`
      }]
    };
  }
  return {
    ok: true,
    graph: read.graph,
    reconciliation,
    provenanceHash: hashCanonicalValue({
      contractId: input.contractId,
      revision: input.revision,
      products: input.products,
      reconciliation
    })
  };
};
