import { Prisma } from '@prisma/client';

/** List/search rows do not render the printable contract, product graph, graph
 * audit history or delivery/payment snapshots. Detail readers retain all of it. */
export const accountingContractListSelect = {
  customerCreditCustomerId: true, customerCreditAmountRials: true, customerCreditRevision: true,
  customerCreditPromisedDate: true, customerCreditTotalRials: true,
  id: true, customerId: true, contractNumber: true, title: true, titlePersian: true,
  createdAt: true, signedAt: true, totalAmount: true, currency: true,
  status: true, isInactive: true, inactiveAt: true, inactiveReason: true,
  commercialFlowVersion: true, commercialRevision: true, salesApprovalRevision: true,
  customerAcceptanceRevision: true, customerAcceptanceMethod: true,
  commercialExpiresAt: true, firstFinancialRecordAt: true, dispatchExpiryExempt: true,
  partnerCaseId: true, partnerKind: true,
  customer: true, items: { where: { retiredAt: null }, select: { totalPrice: true } },
} satisfies Prisma.SalesContractSelect;

export const accountingFinancialSummarySelect = {
  id: true, contractId: true, kind: true, status: true, amount: true,
  currency: true, systemInvoiceNumber: true, systemInvoiceDate: true,
  sepidarAmount: true, financiallyApprovedAt: true, createdAt: true, metadata: true,
} satisfies Prisma.AccountingFinancialRecordSelect;

/** Registers retain action/form fields, but ordinary source evidence belongs to
 * the detail reader. Partner validation still reads its complete source. */
export const accountingFinancialRegisterSelect = {
  id: true, kind: true, status: true, sourceKind: true, sourceId: true,
  contractId: true, customerId: true, periodId: true, amount: true, currency: true,
  metadata: true, idempotencyKey: true, systemInvoiceNumber: true, systemInvoiceDate: true,
  sepidarAmount: true, financiallyApprovedAt: true, financiallyApprovedBy: true,
  createdBy: true, postedAt: true, voidedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.AccountingFinancialRecordSelect;

export const accountingAuditRegisterSelect = {
  id: true, action: true, actorId: true, contractId: true, recordId: true,
  entityType: true, entityId: true, note: true, createdAt: true,
} satisfies Prisma.AccountingAuditLogSelect;

export async function attachPartnerRegisterSnapshots<T extends { id: string; sourceKind: string }>(
  database: Pick<Prisma.TransactionClient, 'accountingFinancialRecord'>, rows: T[],
) {
  const ids = rows.filter(row => row.sourceKind === 'PARTNER_INTERNAL_RECORD').map(row => row.id);
  const snapshots = ids.length ? await database.accountingFinancialRecord.findMany({
    where: { id: { in: ids }, sourceKind: 'PARTNER_INTERNAL_RECORD' },
    select: { id: true, sourceSnapshot: true },
  }) : [];
  const byId = new Map(snapshots.map(row => [row.id, row.sourceSnapshot]));
  return rows.map(row => ({ ...row, sourceSnapshot: byId.get(row.id) ?? null }));
}

/** Preserve every existing date fallback while projecting JSON in PostgreSQL,
 * rather than decoding whole historical snapshots in the API process. */
export async function attachAccountingListDates<T extends { id: string }>(
  database: Pick<Prisma.TransactionClient, '$queryRaw'>, contracts: T[],
): Promise<Array<T & { contractData: Prisma.JsonValue | null }>> {
  if (!contracts.length) return [];
  const dates = await database.$queryRaw<Array<{ id: string; contractData: Prisma.JsonValue }>>(Prisma.sql`
    SELECT id, jsonb_build_object(
      'contractDate', "contractData"->'contractDate',
      'date', "contractData"->'date',
      'contract', jsonb_build_object('date', "contractData"->'contract'->'date')
    ) AS "contractData"
    FROM sales_contracts WHERE id IN (${Prisma.join(contracts.map(row => row.id))})
  `);
  const byId = new Map(dates.map(row => [row.id, row.contractData]));
  return contracts.map(row => ({ ...row, contractData: byId.get(row.id) ?? null }));
}
