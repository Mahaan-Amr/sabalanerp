import { TotalsSchema, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { subtract, sum } from './money';

/** Case writer v1 defines net as the pre-discount product sum, with pass-throughs separate. */
export function caseComparableAmount(raw: unknown): string {
  const totals = TotalsSchema.parse(raw);
  const afterDiscount = subtract(totals.net, totals.discount);
  if (afterDiscount.startsWith('-') || subtract(sum([afterDiscount, totals.tax, totals.charges]), totals.payable) !== '0') {
    throw new Error('Partner commercial totals integrity conflict');
  }
  return afterDiscount;
}

export function comparableRevision(view: PartnerCaseView, envelopes: { wholesaleEnvelope: unknown; retailEnvelope: unknown }) {
  if (!view.sabalanTotals) throw new Error('Partner Sabalan pricing is not ready for comparison');
  for (const [raw, projected] of [[envelopes.wholesaleEnvelope, view.sabalanTotals],
    [envelopes.retailEnvelope, view.retailTotals]] as const) {
    const envelope = raw as { schemaVersion?: number; totals?: unknown } | null;
    if (envelope?.schemaVersion !== 1) throw new Error('Partner commercial policy version unavailable');
    const totals = TotalsSchema.parse(envelope.totals);
    for (const field of ['net', 'discount', 'tax', 'charges', 'payable'] as const) {
      if (subtract(totals[field], projected[field]) !== '0') throw new Error('Partner commercial projection integrity conflict');
    }
    if (totals.currency !== projected.currency) throw new Error('Partner commercial currency integrity conflict');
  }
  return { retail: { amount: caseComparableAmount(view.retailTotals), currency: view.retailTotals.currency },
    sabalan: { amount: caseComparableAmount(view.sabalanTotals), currency: view.sabalanTotals.currency },
    evidenceId: `partner-revision:${view.owner.caseId}:${view.owner.revision}:${view.owner.integrityHash}` };
}

/** Number allocation is the boundary at which a revision becomes commercial
 * reporting evidence. Earlier draft revisions intentionally have no Sabalan
 * totals and must not make an otherwise finalized Case unreadable. */
export function comparableCommercialRevision(
  view: PartnerCaseView,
  envelopes: { wholesaleEnvelope: unknown; retailEnvelope: unknown },
) {
  if (!view.sabalanTotals && !view.customerContractNumber) return null;
  return { view, comparable: comparableRevision(view, envelopes) };
}
