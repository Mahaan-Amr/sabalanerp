import type { PartnerTechnicalDraft, previewPartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { partnerPriceLineTotal } from './partnerRetail';

/** Customer material subtotal on the same family basis as canonicalRetail.
 * Service charges require the server quote and are not estimated here. */
export function partnerProductCartSummary(draft: PartnerTechnicalDraft, preview: ReturnType<typeof previewPartnerTechnicalDraft>) {
  if (!preview.ok || preview.value.inputRevision !== draft.inputRevision || draft.editingValues?.length) return null;
  const lines = [];
  let pricesComplete = true;
  const areas: { quantity: string; rate: { amount: string; currency: 'IRT' } }[] = [];
  for (const row of draft.rows) {
    const calculated = preview.value.rows.find(item => item.productRowId === row.productRowId);
    if (!calculated?.calculation.ok || !('result' in calculated.calculation)) return null;
    const facts = calculated.calculation.result;
    let quantity: string;
    let area: string;
    if ('finishedAreaSquareMeters' in facts) {
      area = facts.finishedAreaSquareMeters;
      quantity = String(facts.packingPlan.consumedSources.length);
    } else if ('requestedAreaSquareMeters' in facts) {
      area = facts.requestedAreaSquareMeters;
      quantity = calculated.family === 'stair' ? String(facts.quantity) : area;
    } else if ('squareMeters' in facts) {
      area = facts.squareMeters; quantity = String(facts.quantity);
    } else return null;
    areas.push({ quantity: area, rate: { amount: '1', currency: 'IRT' } });
    if (!row.retailUnitPrice) pricesComplete = false;
    else lines.push({ quantity, rate: row.retailUnitPrice });
  }
  return { area: partnerPriceLineTotal(areas, 'IRT'),
    materialTotal: pricesComplete ? partnerPriceLineTotal(lines, 'IRT') : null };
}
