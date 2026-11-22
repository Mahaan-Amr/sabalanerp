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
  customer: { select: { id: true, firstName: true, lastName: true, companyName: true,
    nationalCode: true, customFields: true, trustCategory: true, partnerOwnerProfileId: true } },
  items: { where: { retiredAt: null }, select: { totalPrice: true } },
} satisfies Prisma.SalesContractSelect;

export const accountingFinancialSummarySelect = {
  id: true, contractId: true, kind: true, status: true, sourceKind: true, amount: true,
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

/** Unfiltered active ordinary population. Monetary rounding matches the
 * per-contract Accounting row before its values are summed. */
export async function aggregateActiveOrdinaryContracts(database: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const [result] = await database.$queryRaw<Array<{ count: bigint; safe: boolean; contractAmount: string; invoicedAmount: string;
    receivedAmount: string; remainingAmount: string; absoluteBound: string }>>(Prisma.sql`
    WITH contracts AS (
      SELECT id, "totalAmount", currency FROM sales_contracts
      WHERE "partnerCaseId" IS NULL AND "partnerKind" IS NULL AND "isInactive" = false
    ), item_totals AS (
      SELECT i."contractId", SUM(i."totalPrice") AS amount, COUNT(*) AS entries FROM contract_items i
      JOIN contracts c ON c.id = i."contractId" WHERE i."retiredAt" IS NULL GROUP BY i."contractId"
    ), invoice_totals AS (
      SELECT f."contractId", SUM(f.amount) AS amount, COUNT(*) AS entries, MAX(ABS(f.amount)) AS max_amount FROM accounting_financial_records f
      JOIN contracts c ON c.id = f."contractId"
      WHERE f.kind = 'INVOICE_CANDIDATE' AND f.status <> 'VOIDED' GROUP BY f."contractId"
    ), payment_totals AS (
      SELECT p."contractId", SUM(p.amount) AS amount, COUNT(*) AS entries, MAX(ABS(p.amount)) AS max_amount FROM accounting_payment_statuses p
      JOIN contracts c ON c.id = p."contractId"
      WHERE p.status IN ('RECEIVED', 'RECONCILED') GROUP BY p."contractId"
    ), amounts AS (
      SELECT COALESCE(c."totalAmount", i.amount, 0) *
          CASE WHEN lower(btrim(COALESCE(c.currency, ''),
            chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760) ||
            chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) ||
            chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) ||
            chr(8287) || chr(12288) || chr(65279))) IN ('تومان', 'toman') THEN 10 ELSE 1 END AS contract_amount,
        COALESCE(f.amount, 0) AS invoiced, COALESCE(p.amount, 0) AS received,
        (c."totalAmount" IS NOT NULL OR COALESCE(i.entries, 0) = 0)
          AND COALESCE(f.entries, 0) <= 1000 AND COALESCE(f.max_amount, 0) < 1000000000000
          AND COALESCE(p.entries, 0) <= 1000 AND COALESCE(p.max_amount, 0) < 1000000000000 AS row_safe
      FROM contracts c LEFT JOIN item_totals i ON i."contractId" = c.id
      LEFT JOIN invoice_totals f ON f."contractId" = c.id LEFT JOIN payment_totals p ON p."contractId" = c.id
    )
    SELECT COUNT(*)::bigint AS count,
      COALESCE(SUM(ROUND(contract_amount)), 0)::text AS "contractAmount",
      COALESCE(SUM(ROUND(invoiced)), 0)::text AS "invoicedAmount",
      COALESCE(SUM(ROUND(received)), 0)::text AS "receivedAmount",
      COALESCE(SUM(ROUND(GREATEST(contract_amount - received, 0))), 0)::text AS "remainingAmount",
      (COALESCE(BOOL_AND(row_safe), true) AND
        COALESCE(SUM(ABS(ROUND(contract_amount)) + ABS(ROUND(invoiced)) + ABS(ROUND(received)) +
          ABS(ROUND(GREATEST(contract_amount - received, 0)))), 0) < 10000000000000000) AS safe,
      COALESCE(SUM(ABS(ROUND(contract_amount)) + ABS(ROUND(invoiced)) + ABS(ROUND(received)) +
        ABS(ROUND(GREATEST(contract_amount - received, 0)))), 0)::text AS "absoluteBound"
    FROM amounts`);
  return result;
}

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
    SELECT source.id, jsonb_build_object(
      'contractDate', dates."contractDate",
      'date', dates.date,
      'contract', jsonb_build_object('date', dates.contract->'date')
    ) AS "contractData"
    FROM sales_contracts source
    CROSS JOIN LATERAL jsonb_to_record(CASE
      WHEN jsonb_typeof(source."contractData") = 'object' THEN source."contractData" ELSE '{}'::jsonb END)
      AS dates("contractDate" jsonb, date jsonb, contract jsonb)
    WHERE source.id IN (${Prisma.join(contracts.map(row => row.id))})
  `);
  const byId = new Map(dates.map(row => [row.id, row.contractData]));
  return contracts.map(row => ({ ...row, contractData: byId.get(row.id) ?? null }));
}
