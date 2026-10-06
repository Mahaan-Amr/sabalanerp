import type { CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { canonicalJson, type PartnerTechnicalDraft, type Result } from '@sabalanerp/partner-sales-contracts';
import { compilePartnerTechnicalGraph, type PartnerTechnicalGraphContext } from './technicalGraph';
import { technicalGraphMeasures, type TechnicalGraphMeasure } from './technicalGraphMeasures';
import type { TechnicalSavedSnapshot } from './technicalSavedRecords';

const canonical = (value: unknown) => canonicalJson(JSON.parse(JSON.stringify(value)));
const content = ({ inputRevision: _correlation, ...draft }: PartnerTechnicalDraft) => canonical(draft);

/** Called only with owner-decoded, integrity-validated history and freshly
 * resolved evidence. Reuse immutable calculation output, never authorization,
 * inquiry validation, pending edits or a changed commercial intent. */
export function compileOrReuseTechnicalSavedGraph(draft: PartnerTechnicalDraft,
  context: PartnerTechnicalGraphContext, previous: TechnicalSavedSnapshot | null): Result<{
    graph: CanonicalProductGraph; measures: TechnicalGraphMeasure[];
  }> {
  if (previous && !draft.editingValues?.length && !previous.draft.editingValues?.length &&
      !draft.rows.some(row => row.family === 'volumetric') &&
      previous.graph.rows.every(row => row.commercial.calculationSnapshot?.partnerPricingBasis === 'ordinary-sale-v1') &&
      content(draft) === content(previous.draft) && canonical(context) === canonical(previous.context)) {
    return { ok: true, value: { graph: previous.graph, measures: technicalGraphMeasures(previous.graph) } };
  }
  return compilePartnerTechnicalGraph(draft, context);
}
