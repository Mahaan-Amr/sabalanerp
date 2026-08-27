import type { Money, PartnerEvent, Result, RevisionRef } from './contracts';
import type { PartnerAccountingSource, PartnerFinancialPreparation } from './source';

export type CommittedAccountingSource = PartnerAccountingSource & {
  commitment: Extract<PartnerEvent, { type: 'CASE_COMMITTED' }>;
};
export type AccountingQueueEntry = {
  queueEvidenceId: string;
  commitmentEventId: string;
  preparation: PartnerFinancialPreparation;
};

export type AccountingEventIdentity = Pick<PartnerEvent, 'eventId' | 'commandId' | 'correlationId' | 'actorId' | 'recordedAt' | 'effectiveDate'>;
/** An immutable invoice snapshot returned by Accounting, not submitted by a caller. */
export type PartnerInvoiceEvidence = {
  invoiceRecordId: string;
  preparation: PartnerFinancialPreparation;
  /** Actual approved Accounting amount, with explicit currency provenance. */
  amount: Money;
  kind: 'INVOICE_CANDIDATE';
  status: 'DRAFT' | 'READY' | 'APPROVED_FOR_ISSUE' | 'ISSUED' | 'POSTED' | 'VOIDED' | 'NEEDS_CORRECTION';
  approval: (AccountingEventIdentity & { financialApprovalEvidenceId: string }) | null;
};
export type PartnerReceivable = {
  id: string;
  invoiceRecordId: string;
  internalRecordId: string;
  partnerSellerId: string;
  commercialAccountId: string;
  owner: RevisionRef;
  originalAmount: Money;
  dueDate: string;
  paymentPlan: PartnerFinancialPreparation['paymentPlan'];
};
export type PartnerAccountPurchase = {
  source: PartnerAccountingSource;
  /** Accounting resolves the effective replacement chain in one read snapshot.
   * Received/balance include official receipt reversals and check movements; no
   * receipt or pending invoice is added a second time by this projection. */
  official: null | {
    invoice: PartnerInvoiceEvidence;
    receivable: PartnerReceivable;
    received: Money;
    balance: Money;
    status: 'OPEN' | 'OVERDUE' | 'PARTIALLY_PAID' | 'SETTLED' | 'VOIDED';
  };
};
export type PartnerAccountSnapshot = { partnerSellerId: string; purchases: PartnerAccountPurchase[] };
export type PartnerAccountingFact = {
  identity: AccountingEventIdentity;
  owner: RevisionRef;
  internalRecordId: string;
  partnerSellerId: string;
} & ({
  kind: 'RECEIPT'; accountingReceiptId: string; amount: Money;
  method: 'CASH' | 'BANK_TRANSFER' | 'CHECK';
  status: 'RECEIVED' | 'RECONCILED' | 'EXPECTED' | 'REVERSED';
  checkStatus?: 'RECEIVED' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'RETURNED' | 'REPLACED';
} | {
  kind: 'ADJUSTMENT'; originalRealizationEventId: string; correctionId: string;
  delta: string; currency: Money['currency']; reason: string;
});

/** #334 supplies the authenticated, Case-locked transaction and #319 authority.
 * Source reads verify persisted provenance/hash, not just the wire schema. A false
 * Result AND an exception roll back all writes. Replay is also reauthorized.
 * No implementation/route is registered until #315 persistence exists.
 */
export interface PartnerAccountingTransaction {
  readAuthorizedSource(expected: RevisionRef, action: 'QUEUE' | 'PREPARE' | 'APPROVAL' | 'PUBLISH_FACT'): Promise<Result<CommittedAccountingSource>>;
  findQueue(caseId: string): Promise<AccountingQueueEntry | null>;
  /** Unique on Case and original commitment; never replaces a queued snapshot. */
  insertQueue(entry: AccountingQueueEntry): Promise<void>;
  /** Scope lookup to the already-authorized Case; hidden and missing collapse. */
  readInvoice(invoiceRecordId: string, expected: RevisionRef): Promise<PartnerInvoiceEvidence | null>;
  findReceivable(invoiceRecordId: string): Promise<PartnerReceivable | null>;
  /** Only currently effective obligations; replacement requires formal predecessor voiding. */
  findActiveReceivable(internalRecordId: string): Promise<PartnerReceivable | null>;
  /** Unique invoice linkage. Map to official AccountingReceivable only; never a retail Contract. */
  insertReceivable(receivable: PartnerReceivable): Promise<void>;
  /** Append-only unique event ID; same bytes replay, changed bytes reject. Same transaction as Accounting. */
  appendEvent(event: PartnerEvent): Promise<void>;
  /** Resolve the authenticated session's own account with central read policy;
   * hidden, suspended and terminated behavior is #319-owned, never a caller ID. */
  readOwnAccount(): Promise<Result<PartnerAccountSnapshot>>;
  /** Only committed Accounting evidence, after its receipt/correction/void gates.
   * Historical revision provenance and original realization linkage are verified
   * here under the Case lock; no caller-supplied financial fact is accepted. */
  readAccountingFact(factId: string, caseId: string): Promise<PartnerAccountingFact | null>;
}

export interface PartnerAccountingRepository {
  transaction<T>(operation: (tx: PartnerAccountingTransaction) => Promise<Result<T>>): Promise<Result<T>>;
}
