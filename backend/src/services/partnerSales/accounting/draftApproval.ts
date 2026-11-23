import type { AccountingFinancialRecord, Prisma } from '@prisma/client';
import { PartnerEventSchema, canonicalHash, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { PartnerAccountingCommandError } from './errors';
import { readPartnerInvoiceSource } from './invoiceSource';
import { withCurrentSabalanPlan } from './sabalanPlan';
import { matchesFinancialPreparation, PARTNER_INTERNAL_ACCOUNTING_SOURCE, preparePartnerFinancialSource } from './source';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

async function hasSeal(tx: Prisma.TransactionClient, record: AccountingFinancialRecord, owner: RevisionRef, evidenceHash: string) {
  const approval = object(object(record.metadata)?.partnerApproval);
  if (!approval || typeof approval.recordedAt !== 'string' || typeof approval.eventId !== 'string' ||
      record.financiallyApprovedBy !== approval.actorId ||
      approval.financialApprovalEvidenceId !== `partner-financial-approval:${(await canonicalHash({
        invoiceRecordId: record.id, evidenceHash, actorId: approval.actorId, approvedAt: approval.recordedAt,
      })).slice(10)}`) return false;
  if (record.financiallyApprovedAt?.toISOString() === approval.recordedAt &&
      record.systemInvoiceDate?.toISOString().slice(0, 10) === approval.effectiveDate) return true;

  // A replacement that publishes a new obligation seals at activation. Its
  // administrative approval fields still describe the earlier staged action.
  const eventRow = await tx.partnerCaseEvent.findUnique({ where: { id: approval.eventId } });
  const event = PartnerEventSchema.safeParse(object(eventRow?.evidence)?.publicEvent);
  return event.success && event.data.type === 'SABALAN_FINANCIAL_APPROVED' &&
    eventRow?.caseId === owner.caseId && eventRow.caseRevision === owner.revision && eventRow.integrityHash === owner.integrityHash &&
    event.data.eventId === approval.eventId && event.data.internalRecordId === record.sourceId &&
    event.data.financialApprovalEvidenceId === approval.financialApprovalEvidenceId &&
    event.data.recordedAt === approval.recordedAt && event.data.effectiveDate === approval.effectiveDate &&
    event.data.actorId === approval.actorId;
}

/** The initial seal is effective before explicit receivable creation. Staging
 * a replacement only writes partnerStagedApproval, which cannot qualify. */
export async function hasPartnerDraftFinancialApproval(tx: Prisma.TransactionClient, input: {
  owner: RevisionRef; internalRecordId: string;
}) {
  const records = await tx.accountingFinancialRecord.findMany({ where: {
    sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: input.internalRecordId, kind: 'INVOICE_CANDIDATE',
    status: { in: ['ISSUED', 'POSTED'] }, voidedAt: null, financiallyApprovedAt: { not: null },
  } });
  for (const record of records) {
    if (!record.systemInvoiceNumber?.trim() || !record.systemInvoiceDate || !record.amount.gt(0) ||
        !record.sepidarAmount?.equals(record.amount) || !object(object(record.metadata)?.partnerApproval)) continue;
    try {
      const { current, preparation } = await readPartnerInvoiceSource(tx, record, input.owner.caseId);
      if (!current.accounting || current.row.headRevision !== input.owner.revision || current.row.integrityHash !== input.owner.integrityHash) continue;
      if (!await hasSeal(tx, record, preparation.owner, preparation.evidenceHash)) continue;
      if (preparation.owner.revision === input.owner.revision) return preparation.owner.integrityHash === input.owner.integrityHash;

      const view = await withCurrentSabalanPlan(tx, current.accounting);
      const canonical = await preparePartnerFinancialSource({ view, partnerSellerId: current.row.profile.userId }, input.owner);
      if (canonical.ok && matchesFinancialPreparation(canonical.value, preparation)) return true;
    } catch (error) {
      if (!(error instanceof PartnerAccountingCommandError)) throw error;
    }
  }
  return false;
}
