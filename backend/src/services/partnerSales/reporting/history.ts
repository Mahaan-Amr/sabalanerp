import type { PartnerEvent } from '../../../../../packages/partner-sales-contracts';
import { ContractRuntime, Currency, Period, ReportingError } from './contracts';
import { negate, subtract, sum } from './money';

function conflict(): never { throw new ReportingError('INTEGRITY_CONFLICT'); }

/** Revision lineage, not timestamp/ID order, is the causal commercial sequence. */
export function caseHistory(runtime: ContractRuntime, events: PartnerEvent[]) {
  if (events.some(event => event.type === 'CASE_REACTIVATED')) return reactivatedCaseHistory(runtime, events);
  const commitment = events.find((event): event is Extract<PartnerEvent, { type: 'CASE_COMMITTED' }> => event.type === 'CASE_COMMITTED');
  const corrections = events.filter((event): event is Extract<PartnerEvent, { type: 'CORRECTION_EFFECTIVE' }> => event.type === 'CORRECTION_EFFECTIVE')
    .sort((left, right) => left.owner.revision - right.owner.revision);
  const unique: typeof corrections = [];
  const identities = new Map<string, string>();
  let effective = commitment?.owner;
  let effectiveDate = commitment?.effectiveDate;
  for (const event of corrections) {
    const identity = runtime.canonicalJson({ owner: event.owner, predecessor: event.predecessor,
      scope: event.scope, effectiveDate: event.effectiveDate, gateEvidenceIds: event.gateEvidenceIds });
    const prior = identities.get(event.correctionId);
    if (prior) { if (prior !== identity) conflict(); else continue; }
    if (!effective || runtime.checkExpectedRevision(event.predecessor, effective)
      || event.owner.revision <= effective.revision || event.effectiveDate < effectiveDate!) conflict();
    effective = event.owner; effectiveDate = event.effectiveDate;
    unique.push(event); identities.set(event.correctionId, identity);
  }
  const voids = events.filter((event): event is Extract<PartnerEvent, { type: 'CASE_VOIDED' }> => event.type === 'CASE_VOIDED');
  if (voids.length > 1) conflict();
  const voided = voids[0];
  // Cancellation can occur while an approved successor is still a note. It
  // closes that head, but reverses only the last effective commercial sale.
  if (voided && (!effective || voided.owner.caseId !== effective.caseId || voided.owner.revision < effective.revision
    || (voided.owner.revision === effective.revision && runtime.checkExpectedRevision(voided.owner, effective))
    || voided.effectiveDate < effectiveDate!)) conflict();
  return { commitment, corrections: unique, effective, voided, voids, recommitments: [] as Extract<PartnerEvent, { type: 'CASE_RECOMMITTED' }>[], reactivated: false };
}

function reactivatedCaseHistory(runtime: ContractRuntime, events: PartnerEvent[]) {
  const commitment = events.find((event): event is Extract<PartnerEvent, { type: 'CASE_COMMITTED' }> => event.type === 'CASE_COMMITTED');
  const corrections = events.filter((event): event is Extract<PartnerEvent, { type: 'CORRECTION_EFFECTIVE' }> => event.type === 'CORRECTION_EFFECTIVE');
  const voids = events.filter((event): event is Extract<PartnerEvent, { type: 'CASE_VOIDED' }> => event.type === 'CASE_VOIDED');
  const activations = events.filter((event): event is Extract<PartnerEvent, { type: 'CASE_REACTIVATED' }> => event.type === 'CASE_REACTIVATED');
  const recommitments = events.filter((event): event is Extract<PartnerEvent, { type: 'CASE_RECOMMITTED' }> => event.type === 'CASE_RECOMMITTED');
  const cancelled = new Set<string>();
  const renewed = new Set<string>();
  for (const activation of activations) {
    const cancellation = events.find(event => event.eventId === activation.cancellationEventId);
    if (!cancellation || !['CASE_VOIDED', 'CASE_CANCELLED'].includes(cancellation.type)
      || cancellation.owner.caseId !== activation.owner.caseId || cancelled.has(cancellation.eventId)
      || runtime.checkExpectedRevision(cancellation.owner, activation.owner)
      || cancellation.effectiveDate > activation.effectiveDate) conflict();
    cancelled.add(cancellation.eventId);
  }
  for (const event of recommitments) {
    const activation = activations.find(item => item.eventId === event.reactivationEventId);
    if (!commitment || event.commitmentEventId !== commitment.eventId || !activation || renewed.has(activation.eventId)
      || event.owner.revision < activation.owner.revision || event.effectiveDate < activation.effectiveDate
      || event.internalRecordId !== commitment.internalRecordId || event.sabalanNetAmount.currency !== commitment.sabalanNetAmount.currency) conflict();
    renewed.add(activation.eventId);
  }
  let effective = commitment?.owner;
  let effectiveDate = commitment?.effectiveDate;
  const identities = new Map<string, string>();
  const uniqueCorrections: typeof corrections = [];
  for (const event of [...corrections, ...recommitments].sort((a, b) => a.owner.revision - b.owner.revision || a.recordedAt.localeCompare(b.recordedAt))) {
    if (!effective || event.effectiveDate < effectiveDate!) conflict();
    if (event.type === 'CORRECTION_EFFECTIVE') {
      const identity = runtime.canonicalJson(event);
      const previous = identities.get(event.correctionId);
      if (previous) { if (previous !== identity) conflict(); continue; }
      if (runtime.checkExpectedRevision(event.predecessor, effective) || event.owner.revision <= effective.revision) conflict();
      identities.set(event.correctionId, identity); uniqueCorrections.push(event);
    } else if (event.owner.revision < effective.revision) conflict();
    effective = event.owner; effectiveDate = event.effectiveDate;
  }
  const outstandingVoids = voids.filter(event => !cancelled.has(event.eventId));
  if (outstandingVoids.length > 1) conflict();
  const voided = outstandingVoids[0];
  if (voided && effective && voided.owner.revision < effective.revision) conflict();
  return { commitment, corrections: uniqueCorrections, effective, voided, voids, recommitments, reactivated: true };
}

/** Build receipt identities before resolving reversals, including timestamp ties. */
export function collectionHistory(events: PartnerEvent[], context: { planIds: Set<string>; currency: Currency; period: Period }) {
  const receipts = new Map<string, Extract<PartnerEvent, { type: 'RETAIL_RECEIPT' }>>();
  const all: string[] = []; const period: string[] = [];
  for (const event of events) {
    if (event.type !== 'RETAIL_RECEIPT') continue;
    if (event.amount.currency !== context.currency || !context.planIds.has(event.planId)) conflict();
    const prior = receipts.get(event.receiptId);
    if (prior) {
      if (subtract(prior.amount.amount, event.amount.amount) !== '0' || prior.planId !== event.planId
        || prior.effectiveDate !== event.effectiveDate) conflict();
      continue;
    }
    receipts.set(event.receiptId, event); all.push(event.amount.amount);
    if (event.effectiveDate >= context.period.from) period.push(event.amount.amount);
  }
  const reversed = new Map<string, string[]>();
  const identities = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'RETAIL_RECEIPT_REVERSED') continue;
    const original = receipts.get(event.originalReceiptId);
    const identity = `${event.originalReceiptId}:${event.planId}:${event.amount.currency}:${sum([event.amount.amount])}:${event.effectiveDate}`;
    const prior = identities.get(event.reversalId);
    if (prior) { if (prior !== identity) conflict(); else continue; }
    if (!original || original.planId !== event.planId || original.amount.currency !== event.amount.currency
      || event.recordedAt < original.recordedAt || event.effectiveDate < original.effectiveDate) conflict();
    const amounts = reversed.get(event.originalReceiptId) || [];
    amounts.push(event.amount.amount); reversed.set(event.originalReceiptId, amounts);
    if (subtract(original.amount.amount, sum(amounts)).startsWith('-')) conflict();
    identities.set(event.reversalId, identity); all.push(negate(event.amount.amount));
    if (event.effectiveDate >= context.period.from) period.push(negate(event.amount.amount));
  }
  return { collected: sum(all), periodCollected: sum(period) };
}
