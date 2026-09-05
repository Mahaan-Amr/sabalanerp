import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { z } from 'zod';
import { CaseGraphRefSchema } from './case';
import { RevisionRef, RevisionRefSchema } from './primitives';
import { canonicalHash } from './integrity';
import { partnerError, Result } from './errors';

/** Adapter to the existing graph parser, never a parallel geometry/pricing model.
 * Caller owns the full immutable graph snapshot; projections receive this ref.
 * Graph's mutation counter need not equal the encompassing Case revision.
 */
export async function bindCanonicalCaseGraph(owner: RevisionRef, snapshot: unknown): Promise<Result<z.infer<typeof CaseGraphRefSchema>>> {
  try {
    RevisionRefSchema.parse(owner);
    const graph = parseCanonicalProductGraph(snapshot);
    const value = CaseGraphRefSchema.parse({ owner, schemaVersion: graph.schemaVersion,
      graphHash: await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph }),
      productRowIds: graph.rows.map(row => row.productRowId) });
    return { ok: true, value };
  } catch {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
}
