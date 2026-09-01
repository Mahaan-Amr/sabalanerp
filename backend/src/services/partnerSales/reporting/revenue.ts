import type { PartnerEvent } from '../../../../../packages/partner-sales-contracts';
import { ContractRuntime, Period, ReportingError, RevenueEntry } from './contracts';
import { sum } from './money';

export const effectiveThrough = (period: Period) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(period.asOf));
  return period.to < today ? period.to : today;
};

export function visibleEvents(runtime: ContractRuntime, input: readonly PartnerEvent[], period: Period): PartnerEvent[] {
  runtime.DateSchema.parse(period.from); runtime.DateSchema.parse(period.to); runtime.InstantSchema.parse(period.asOf);
  if (period.from > period.to) throw new ReportingError('INVALID_PAYLOAD');
  const seen = new Map<string, string>();
  const events: PartnerEvent[] = [];
  for (const raw of input) {
    const event = runtime.PartnerEventSchema.parse(raw);
    if (event.recordedAt > period.asOf || event.effectiveDate > effectiveThrough(period)) continue;
    const value = runtime.canonicalJson(event);
    if (seen.has(event.eventId)) {
      if (seen.get(event.eventId) !== value) throw new ReportingError('INTEGRITY_CONFLICT');
      continue;
    }
    seen.set(event.eventId, value); events.push(event);
  }
  return events.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId));
}

/** Ordinary Sales/BI integration hook: accepts internal events ONLY, never retail DTOs.
 * The integration writer must union this ledger with ordinary Sales, excluding
 * PARTNER_CUSTOMER compatibility rows. No ordinary SalesContract write is made here.
 */
export function projectSabalanRevenue(runtime: ContractRuntime, input: readonly PartnerEvent[], period: Period): RevenueEntry[] {
  const events = visibleEvents(runtime, input, period);
  const commitments = new Map<string, Extract<PartnerEvent, { type: 'CASE_COMMITTED' }>>();
  const aliases = new Map<string, string>();
  const entries = new Map<string, RevenueEntry>();
  for (const event of events) {
    if (event.type !== 'CASE_COMMITTED') continue;
    const first = commitments.get(event.owner.caseId);
    if (first && (first.internalRecordId !== event.internalRecordId || first.salesCreditOwnerId !== event.salesCreditOwnerId
      || first.sabalanNetAmount.currency !== event.sabalanNetAmount.currency
      || sum([first.sabalanNetAmount.amount]) !== sum([event.sabalanNetAmount.amount])
      || runtime.checkExpectedRevision(first.owner, event.owner))) throw new ReportingError('INTEGRITY_CONFLICT');
    aliases.set(event.eventId, event.owner.caseId);
    if (first) continue;
    commitments.set(event.owner.caseId, event);
    const sourceKey = `partner:realized:${event.owner.caseId}`;
    entries.set(sourceKey, { sourceKind: 'SABALAN_TO_PARTNER', sourceKey, caseId: event.owner.caseId,
      internalRecordId: event.internalRecordId, sellerId: event.salesCreditOwnerId, eventId: event.eventId,
      effectiveDate: event.effectiveDate, recordedAt: event.recordedAt, type: 'REALIZED',
      amount: sum([event.sabalanNetAmount.amount]), currency: event.sabalanNetAmount.currency });
  }
  for (const event of events) {
    if (event.type !== 'SABALAN_ADJUSTMENT') continue;
    const original = commitments.get(event.owner.caseId);
    if (!original || aliases.get(event.originalRealizationEventId) !== event.owner.caseId
      || original.internalRecordId !== event.internalRecordId || original.sabalanNetAmount.currency !== event.currency
      || event.effectiveDate < original.effectiveDate) throw new ReportingError('INTEGRITY_CONFLICT');
    const sourceKey = `partner:adjustment:${event.owner.caseId}:${event.correctionId}`;
    const prior = entries.get(sourceKey);
    if (prior && (prior.amount !== sum([event.delta]) || prior.effectiveDate !== event.effectiveDate)) {
      throw new ReportingError('INTEGRITY_CONFLICT');
    }
    if (prior) continue;
    entries.set(sourceKey, { sourceKind: 'SABALAN_TO_PARTNER', sourceKey, caseId: event.owner.caseId,
      internalRecordId: event.internalRecordId, sellerId: original.salesCreditOwnerId, eventId: event.eventId,
      effectiveDate: event.effectiveDate, recordedAt: event.recordedAt, type: 'ADJUSTMENT', amount: sum([event.delta]), currency: event.currency });
  }
  return [...entries.values()].filter(row => row.effectiveDate >= period.from)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.sourceKey.localeCompare(b.sourceKey));
}
