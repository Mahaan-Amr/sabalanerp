import { Prisma } from '@prisma/client';
import type { PartnerEvent } from '@sabalanerp/partner-sales-contracts';
import { readPartnerCollections } from './collections';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './financialApproval';
import type { PartnerAccountPurchase, PartnerInvoiceEvidence, PartnerReceivable } from './repository';
import type { PartnerFinancialPreparation } from './source';
import { subtract } from '../reporting/money';
import { readPartnerInvoiceSource } from './invoiceSource';
import { readPartnerReceivableEvidence } from './receivableEvidence';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export class PartnerOfficialAccountingIntegrityError extends Error {}
const conflict = (): never => { throw new PartnerOfficialAccountingIntegrityError('Partner official Accounting evidence integrity conflict'); };

export function latestPartnerFinancialApproval(events: readonly PartnerEvent[]) {
  return events.filter((event): event is Extract<PartnerEvent, { type: 'SABALAN_FINANCIAL_APPROVED' }> =>
    event.type === 'SABALAN_FINANCIAL_APPROVED').sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId)).at(-1);
}

/** Resolve the effective obligation by its published approval, not a mutable latest draft. */
export async function readPartnerOfficialPurchase(tx: Prisma.TransactionClient, input: {
  internalRecordId: string; approval: ReturnType<typeof latestPartnerFinancialApproval>;
  cutoff: Date; asOf: Date; voided: boolean;
}): Promise<{ official: PartnerAccountPurchase['official']; covered: boolean }> {
  const approved = input.approval;
  if (!approved) return { official: null, covered: true };
  if (approved.internalRecordId !== input.internalRecordId) return conflict();
  const receivableRow = await tx.accountingReceivable.findUnique({ where: { id: approved.accountingReceivableId },
    include: { invoiceRecord: true } });
  const invoiceRow = receivableRow?.invoiceRecord;
  if (!receivableRow || !invoiceRow || receivableRow.createdAt > input.asOf || invoiceRow.createdAt > input.asOf ||
      invoiceRow.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoiceRow.sourceId !== input.internalRecordId ||
      invoiceRow.kind !== 'INVOICE_CANDIDATE' || !invoiceRow.financiallyApprovedAt || !invoiceRow.financiallyApprovedBy ||
      invoiceRow.financiallyApprovedAt > input.asOf || invoiceRow.contractId || invoiceRow.customerId ||
      receivableRow.contractId || receivableRow.customerId) return conflict();
  const canonical = await readPartnerInvoiceSource(tx, invoiceRow, approved.owner.caseId);
  readPartnerReceivableEvidence(receivableRow, canonical.preparation);
  const preparation = object(object(invoiceRow.sourceSnapshot)?.partnerPreparation ?? invoiceRow.sourceSnapshot);
  const approval = object(object(invoiceRow.metadata)?.partnerApproval);
  const receivable = object(object(receivableRow.metadata)?.partnerReceivable);
  const originalAmount = object(receivable?.originalAmount);
  if (!preparation || !approval || !receivable || !originalAmount ||
      approval.eventId !== approved.eventId || approval.actorId !== approved.actorId ||
      approval.financialApprovalEvidenceId !== approved.financialApprovalEvidenceId ||
      invoiceRow.financiallyApprovedBy !== approved.actorId ||
      receivable.id !== receivableRow.id || receivable.invoiceRecordId !== invoiceRow.id ||
      receivable.internalRecordId !== input.internalRecordId ||
      originalAmount.currency !== receivableRow.currency || typeof originalAmount.amount !== 'string' ||
      subtract(originalAmount.amount, receivableRow.originalAmount.toString()) !== '0' ||
      invoiceRow.currency !== approved.amount.currency || receivableRow.currency !== approved.amount.currency ||
      subtract(invoiceRow.amount.toString(), approved.amount.amount) !== '0') return conflict();
  const invoice: PartnerInvoiceEvidence = { invoiceRecordId: invoiceRow.id, kind: 'INVOICE_CANDIDATE',
    status: input.voided ? 'VOIDED' : 'ISSUED', preparation: preparation as PartnerFinancialPreparation,
    amount: { amount: invoiceRow.amount.toString(), currency: approved.amount.currency },
    approval: approval as PartnerInvoiceEvidence['approval'] };
  const collected = await readPartnerCollections(tx, { receivableId: receivableRow.id,
    currency: receivableRow.currency, cutoff: input.cutoff, asOf: input.asOf, preparation: canonical.preparation });
  if (collected === null) return { official: null, covered: false };
  const remaining = subtract(receivableRow.originalAmount.toString(), collected);
  const balance = remaining.startsWith('-') ? '0' : remaining;
  return { covered: true, official: { invoice, receivable: receivable as PartnerReceivable,
    received: { amount: collected, currency: approved.amount.currency },
    balance: { amount: balance, currency: approved.amount.currency },
    status: input.voided ? 'VOIDED' : balance === '0' ? 'SETTLED' : collected === '0' ? 'OPEN' : 'PARTIALLY_PAID' } };
}
