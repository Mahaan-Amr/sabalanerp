import { contracts, type PartnerEvent, type Result } from './contracts';
import type { CommittedAccountingSource, PartnerAccountingFact } from './repository';
import { equalAmounts, failure } from './source';

export function accountingFactEvent(source: CommittedAccountingSource, fact: PartnerAccountingFact): Result<PartnerEvent> {
  if (fact.owner.caseId !== source.view.owner.caseId || fact.owner.revision > source.view.owner.revision ||
      fact.internalRecordId !== source.view.recordId || fact.partnerSellerId !== source.partnerSellerId ||
      (fact.owner.revision === source.view.owner.revision && fact.owner.integrityHash !== source.view.owner.integrityHash)) return failure('INTEGRITY_CONFLICT');
  const base = { schemaVersion: 1, owner: fact.owner, internalRecordId: fact.internalRecordId,
    eventId: fact.identity.eventId, commandId: fact.identity.commandId, correlationId: fact.identity.correlationId,
    actorId: fact.identity.actorId, recordedAt: fact.identity.recordedAt, effectiveDate: fact.identity.effectiveDate };
  let event: unknown;
  if (fact.kind === 'RECEIPT') {
    // A received check is custody, not collection. Reversals retain their own
    // dated Accounting history; v1 has no negative SABALAN_RECEIPT wire variant.
    if (!['RECEIVED', 'RECONCILED'].includes(fact.status) ||
        (fact.method === 'CHECK' && fact.checkStatus !== 'CLEARED')) return failure('STATE_CONFLICT');
    if (!['CASH', 'BANK_TRANSFER', 'CHECK'].includes(fact.method) ||
        !contracts.MoneySchema.safeParse(fact.amount).success || fact.amount.currency !== source.view.totals.currency ||
        equalAmounts(fact.amount.amount, '0')) return failure('INTEGRITY_CONFLICT');
    event = { ...base, type: 'SABALAN_RECEIPT', accountingReceiptId: fact.accountingReceiptId, amount: fact.amount };
  } else {
    if (fact.originalRealizationEventId !== source.commitment.eventId || fact.currency !== source.view.totals.currency) return failure('INTEGRITY_CONFLICT');
    event = { ...base, type: 'SABALAN_ADJUSTMENT', originalRealizationEventId: fact.originalRealizationEventId,
      correctionId: fact.correctionId, delta: fact.delta, currency: fact.currency, reason: fact.reason };
  }
  const parsed = contracts.PartnerEventSchema.safeParse(event);
  return parsed.success ? { ok: true, value: parsed.data } : failure('INTEGRITY_CONFLICT');
}
