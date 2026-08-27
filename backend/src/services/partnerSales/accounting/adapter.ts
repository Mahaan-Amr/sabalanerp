import { contracts, type AccountingPartnerPort, type RevisionRef } from './contracts';
import type { PartnerAccountingRepository } from './repository';
import { equalAmounts, failure, prepareCommittedAccountingSource } from './source';
import { projectPartnerAccount } from './account';
import { accountingFactEvent } from './events';

export function createPartnerAccountingAdapter(repository: PartnerAccountingRepository) {
  const enqueueCommitted: AccountingPartnerPort['enqueueCommitted'] = async (view, event) => {
    const parsedView = contracts.SabalanInternalRecordViewSchema.safeParse(view);
    const parsedEvent = contracts.PartnerEventSchema.safeParse(event);
    if (!parsedView.success || !parsedEvent.success || parsedEvent.data.type !== 'CASE_COMMITTED') return failure('INVALID_PAYLOAD');
    return repository.transaction(async tx => {
      const loaded = await tx.readAuthorizedSource(parsedView.data.owner, 'QUEUE');
      if (!loaded.ok) return loaded;
      const source = loaded.value;
      const prepared = await prepareCommittedAccountingSource(source, parsedView.data.owner);
      if (!prepared.ok) return prepared;
      if (source.view.state !== 'COMMITTED') return failure('STATE_CONFLICT');
      if (contracts.canonicalJson(parsedView.data) !== contracts.canonicalJson(source.view) ||
          contracts.canonicalJson(parsedEvent.data) !== contracts.canonicalJson(source.commitment) ||
          source.commitment.internalRecordId !== source.view.recordId ||
          source.commitment.salesCreditOwnerId !== source.partnerSellerId ||
          contracts.checkExpectedRevision(source.commitment.owner, source.view.owner)) return failure('INTEGRITY_CONFLICT');
      const existing = await tx.findQueue(source.view.owner.caseId);
      if (existing) {
        if (existing.commitmentEventId !== source.commitment.eventId || existing.preparation.evidenceHash !== prepared.value.evidenceHash) return failure('IDEMPOTENCY_CONFLICT');
        return { ok: true, value: { queueEvidenceId: existing.queueEvidenceId } };
      }
      const queueEvidenceId = `partner-accounting:${(await contracts.canonicalHash(source.commitment.eventId)).slice(10)}`;
      await tx.insertQueue({ queueEvidenceId, commitmentEventId: source.commitment.eventId, preparation: prepared.value });
      return { ok: true, value: { queueEvidenceId } };
    });
  };

  return {
    enqueueCommitted,
    readOwnAccount: (partnerSellerId: string) => repository.transaction(async tx => {
      const snapshot = await tx.readOwnAccount();
      return snapshot.ok ? projectPartnerAccount(snapshot.value, partnerSellerId) : snapshot;
    }),
    publishAccountingFact: (expected: RevisionRef, factId: string) => repository.transaction(async tx => {
      const source = await tx.readAuthorizedSource(expected, 'PUBLISH_FACT');
      if (!source.ok) return source;
      const prepared = await prepareCommittedAccountingSource(source.value, expected);
      if (!prepared.ok) return prepared;
      const fact = await tx.readAccountingFact(factId);
      if (!fact) return failure('NOT_FOUND');
      const event = accountingFactEvent(source.value, fact);
      if (!event.ok) return event;
      await tx.appendEvent(event.value);
      return { ok: true, value: { eventId: event.value.eventId } };
    }),
    prepareFinancialRecord: (expected: RevisionRef) => repository.transaction(async tx => {
      const source = await tx.readAuthorizedSource(expected, 'PREPARE');
      if (!source.ok) return source;
      if (source.value.view.state !== 'COMMITTED') return failure('STATE_CONFLICT');
      return prepareCommittedAccountingSource(source.value, expected);
    }),
    /** Hook after the existing Accounting workflow has approved an invoice. The
     * repository must join that same transaction, not commit approval separately. */
    acceptFinancialApproval: (expected: RevisionRef, invoiceRecordId: string) => repository.transaction(async tx => {
      const loaded = await tx.readAuthorizedSource(expected, 'APPROVAL');
      if (!loaded.ok) return loaded;
      if (loaded.value.view.state !== 'COMMITTED') return failure('STATE_CONFLICT');
      const prepared = await prepareCommittedAccountingSource(loaded.value, expected);
      if (!prepared.ok) return prepared;
      const invoice = await tx.readInvoice(invoiceRecordId);
      if (!invoice) return failure('NOT_FOUND');
      if (invoice.kind !== 'INVOICE_CANDIDATE' || !['ISSUED', 'POSTED'].includes(invoice.status) || !invoice.approval) return failure('STATE_CONFLICT');
      if (!contracts.MoneySchema.safeParse(invoice.amount).success || invoice.amount.currency !== prepared.value.amount.currency ||
          !equalAmounts(invoice.amount.amount, prepared.value.amount.amount)) return failure('INTEGRITY_CONFLICT');
      if (contracts.canonicalJson(invoice.preparation) !== contracts.canonicalJson(prepared.value)) return failure('INTEGRITY_CONFLICT');
      const prior = await tx.findReceivable(invoiceRecordId);
      const active = await tx.findActiveReceivable(prepared.value.internalRecordId);
      if (active && active.invoiceRecordId !== invoiceRecordId) return failure('DEPENDENCY_BLOCKED');
      const receivable = {
        id: `partner-receivable:${(await contracts.canonicalHash(invoiceRecordId)).slice(10)}`, invoiceRecordId,
        internalRecordId: prepared.value.internalRecordId,
        partnerSellerId: prepared.value.debtor.partnerSellerId, commercialAccountId: prepared.value.debtor.commercialAccountId,
        owner: prepared.value.owner, originalAmount: prepared.value.amount, paymentPlan: prepared.value.paymentPlan,
        dueDate: [...prepared.value.paymentPlan.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate || prepared.value.paymentPlan.effectiveDate,
      };
      if (prior && contracts.canonicalJson(prior) !== contracts.canonicalJson(receivable)) return failure('INTEGRITY_CONFLICT');
      const approval = invoice.approval;
      const event = contracts.PartnerEventSchema.safeParse({
        schemaVersion: 1, type: 'SABALAN_FINANCIAL_APPROVED', owner: prepared.value.owner,
        eventId: approval.eventId, commandId: approval.commandId, correlationId: approval.correlationId,
        actorId: approval.actorId, recordedAt: approval.recordedAt, effectiveDate: approval.effectiveDate,
        internalRecordId: prepared.value.internalRecordId, accountingReceivableId: receivable.id,
        financialApprovalEvidenceId: approval.financialApprovalEvidenceId, amount: prepared.value.amount,
      });
      if (!event.success) return failure('INTEGRITY_CONFLICT');
      if (!prior) await tx.insertReceivable(receivable);
      await tx.appendEvent(event.data);
      return { ok: true, value: { accountingReceivableId: receivable.id, eventId: event.data.eventId } };
    }),
  };
}
