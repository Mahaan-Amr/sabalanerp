import { Prisma } from '@prisma/client';
import type { PartnerEvent } from '@sabalanerp/partner-sales-contracts';
import { readPartnerCollections } from './collections';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './financialApproval';
import type { PartnerAccountPurchase, PartnerInvoiceEvidence } from './repository';
import type { AccountingReadScope } from './readScope';
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

type Approval = NonNullable<ReturnType<typeof latestPartnerFinancialApproval>>;
type PurchaseResult = { official: PartnerAccountPurchase['official']; covered: boolean };
type PurchaseRows = Omit<ReturnType<AccountingReadScope['verifiedPurchaseRows']>, 'payments'>;

function assertOfficialSource(invoice: PurchaseRows['invoice'], receivable: PurchaseRows['receivable'],
  internalRecordId: string, asOf: Date) {
  if (invoice.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoice.sourceId !== internalRecordId ||
      invoice.kind !== 'INVOICE_CANDIDATE' || invoice.contractId || invoice.customerId || receivable.contractId ||
      receivable.customerId || receivable.createdAt > asOf || invoice.createdAt > asOf || !invoice.financiallyApprovedBy ||
      !invoice.financiallyApprovedAt || invoice.financiallyApprovedAt > asOf) conflict();
}

/** These reciprocal checks bind the published event to its invoice and receivable.
 * Both readers supply a canonically verified preparation and receivable witness. */
function verifyOfficialPurchase(rows: PurchaseRows, approved: Approval, internalRecordId: string, voided: boolean) {
  const { invoice: invoiceRow, receivable: receivableRow, evidence, preparation } = rows;
  const approval = object(object(invoiceRow.metadata)?.partnerApproval);
  if (approved.internalRecordId !== internalRecordId || receivableRow.id !== approved.accountingReceivableId ||
      !approval || approval.eventId !== approved.eventId || approval.actorId !== approved.actorId ||
      approval.financialApprovalEvidenceId !== approved.financialApprovalEvidenceId ||
      invoiceRow.financiallyApprovedBy !== approved.actorId || evidence.id !== receivableRow.id ||
      evidence.invoiceRecordId !== invoiceRow.id || evidence.internalRecordId !== internalRecordId ||
      evidence.originalAmount.currency !== receivableRow.currency || typeof evidence.originalAmount.amount !== 'string' ||
      subtract(evidence.originalAmount.amount, receivableRow.originalAmount.toString()) !== '0' ||
      invoiceRow.currency !== approved.amount.currency || receivableRow.currency !== approved.amount.currency ||
      subtract(invoiceRow.amount.toString(), approved.amount.amount) !== '0') return conflict();
  const invoice: PartnerInvoiceEvidence = { invoiceRecordId: invoiceRow.id, kind: 'INVOICE_CANDIDATE',
    status: voided ? 'VOIDED' : 'ISSUED', preparation,
    amount: { amount: invoiceRow.amount.toString(), currency: approved.amount.currency },
    approval: approval as PartnerInvoiceEvidence['approval'] };
  return (collected: string | null): PurchaseResult => {
    if (collected === null) return { official: null, covered: false };
    const remaining = subtract(receivableRow.originalAmount.toString(), collected);
    const balance = remaining.startsWith('-') ? '0' : remaining;
    return { covered: true, official: { invoice, receivable: evidence,
      received: { amount: collected, currency: approved.amount.currency },
      balance: { amount: balance, currency: approved.amount.currency },
      status: voided ? 'VOIDED' : balance === '0' ? 'SETTLED' : collected === '0' ? 'OPEN' : 'PARTIALLY_PAID' } };
  };
}

/** The scope owns complete authorized rows from one repeatable-read snapshot.
 * Verify the official publication on its first effective period. */
export function scopedPartnerOfficialPurchase(scope: AccountingReadScope, invoiceId: string,
  internalRecordId: string, approved: Approval, asOf: Date) {
  const rows = scope.verifiedPurchaseRows(invoiceId, approved.accountingReceivableId, approved.owner.caseId);
  let project: ReturnType<typeof verifyOfficialPurchase> | undefined;
  return { payments: rows.payments, atCollection(collected: string | null) {
    if (!project) {
      assertOfficialSource(rows.invoice, rows.receivable, internalRecordId, asOf);
      project = verifyOfficialPurchase(rows, approved, internalRecordId, false);
    }
    return project(collected);
  } };
}

/** Resolve the effective obligation by its published approval, not a mutable latest draft. */
export async function readPartnerOfficialPurchase(tx: Prisma.TransactionClient, input: {
  internalRecordId: string; approval: ReturnType<typeof latestPartnerFinancialApproval>;
  cutoff: Date; asOf: Date; voided: boolean;
}): Promise<PurchaseResult> {
  const approved = input.approval;
  if (!approved) return { official: null, covered: true };
  if (approved.internalRecordId !== input.internalRecordId) return conflict();
  const receivable = await tx.accountingReceivable.findUnique({ where: { id: approved.accountingReceivableId },
    include: { invoiceRecord: true } });
  const invoice = receivable?.invoiceRecord;
  if (!receivable || !invoice) return conflict();
  assertOfficialSource(invoice, receivable, input.internalRecordId, input.asOf);
  const { preparation } = await readPartnerInvoiceSource(tx, invoice, approved.owner.caseId);
  const evidence = readPartnerReceivableEvidence(receivable, preparation);
  const project = verifyOfficialPurchase({ invoice, receivable, evidence, preparation }, approved,
    input.internalRecordId, input.voided);
  const collected = await readPartnerCollections(tx, { receivableId: receivable.id,
    currency: receivable.currency, cutoff: input.cutoff, asOf: input.asOf, preparation });
  return project(collected);
}
