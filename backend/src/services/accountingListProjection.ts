import { Prisma } from '@prisma/client';

/** List/search rows do not render the printable contract, product graph, graph
 * audit history or delivery/payment snapshots. Detail readers retain all of it. */
export const accountingContractListSelect = {
  id: true, contractNumber: true, title: true, titlePersian: true,
  createdAt: true, signedAt: true, totalAmount: true, currency: true,
  status: true, isInactive: true, inactiveAt: true, inactiveReason: true,
  customer: true, items: { select: { totalPrice: true } },
} satisfies Prisma.SalesContractSelect;

export const accountingFinancialSummarySelect = {
  id: true, contractId: true, kind: true, status: true, amount: true,
  currency: true, systemInvoiceNumber: true, systemInvoiceDate: true,
  sepidarAmount: true, financiallyApprovedAt: true, createdAt: true, metadata: true,
} satisfies Prisma.AccountingFinancialRecordSelect;

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
