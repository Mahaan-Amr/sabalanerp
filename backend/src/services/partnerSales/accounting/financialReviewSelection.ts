import type { Prisma } from '@prisma/client';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';

/** Resolve a review's relational owners inside its authorized snapshot. Audit
 * entity references can name a different owner even without private JSON. */
export async function financialReviewOwners(database: Prisma.TransactionClient, recordId: string, includeAudit: boolean) {
  const headers = includeAudit ? await database.accountingAuditLog.findMany({ where: { recordId },
    select: { entityId: true } }) : [];
  const entityIds = [...new Set(headers.flatMap(row => row.entityId ? [row.entityId] : []))];
  const [receivables, payments, taxes, corrections, flags] = entityIds.length ? await Promise.all([
    database.accountingReceivable.findMany({ where: { id: { in: entityIds } }, select: { invoiceRecordId: true, contractId: true } }),
    database.accountingPaymentStatus.findMany({ where: { id: { in: entityIds } },
      select: { contractId: true, receivable: { select: { invoiceRecordId: true, contractId: true } } } }),
    database.accountingTaxRecord.findMany({ where: { id: { in: entityIds } }, select: { invoiceRecordId: true, contractId: true } }),
    database.accountingCorrectionRequest.findMany({ where: { id: { in: entityIds } }, select: { recordId: true, contractId: true } }),
    database.accountingContractFlag.findMany({ where: { id: { in: entityIds } }, select: { sourceFinancialRecordId: true, contractId: true } }),
  ]) : [[], [], [], [], []];
  const recordIds = [...new Set([recordId, ...entityIds,
    ...receivables.flatMap(row => row.invoiceRecordId ? [row.invoiceRecordId] : []),
    ...payments.flatMap(row => row.receivable?.invoiceRecordId ? [row.receivable.invoiceRecordId] : []),
    ...taxes.flatMap(row => row.invoiceRecordId ? [row.invoiceRecordId] : []),
    ...corrections.flatMap(row => row.recordId ? [row.recordId] : []),
    ...flags.flatMap(row => row.sourceFinancialRecordId ? [row.sourceFinancialRecordId] : []),
  ])];
  const records = await database.accountingFinancialRecord.findMany({ where: { id: { in: recordIds } },
    select: { sourceKind: true, sourceId: true, contractId: true } });
  return {
    internalRecordIds: new Set(records.flatMap(row => row.sourceKind === PARTNER_INTERNAL_ACCOUNTING_SOURCE && row.sourceId ? [row.sourceId] : [])),
    contractIds: new Set([...records, ...receivables, ...payments, ...taxes, ...corrections, ...flags,
      ...payments.flatMap(row => row.receivable ? [row.receivable] : [])].flatMap(row => row.contractId ? [row.contractId] : [])),
  };
}
