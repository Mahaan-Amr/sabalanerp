import { Prisma } from '@prisma/client';
import { ACTIVE_CORRECTION_STATUSES, REVIEWABLE_ATTENTION_WEIGHT as weight } from './accountingPopulations';
import { accountingMarkedFinancialSources, ordinaryContractCurrencyMultiplier } from './accountingListProjection';

type ReviewableMoney = { contractAmount: string; invoicedAmount: string; receivedAmount: string; remainingAmount: string };
type PartnerCandidate = ReviewableMoney & { index: number; score: number; priority: number | null; waitingSince: Date | string | null };
type PageRow = { contractId: string | null; partnerIndex: number | null };
type PageResult = ReviewableMoney & { total: bigint; safe: boolean; rows: PageRow[] };

// Child evidence uses the recursive JavaScript presence predicate. Strict
// paths avoid implicit property unwrapping. Structured sourceKind values can
// coerce to a marker or throw in JavaScript. Keep the authoritative path.
const childMarker = `strict $.** ? (exists(@.partnerCaseId) || exists(@.partnerPreparation) ||
  exists(@.partnerReceivable) || exists(@.partnerFact) || exists(@.financialEvidenceHash) ||
  @.sourceKind == "PARTNER_INTERNAL_RECORD" || @.sourceKind == "SABALAN_TO_PARTNER")`;
const ambiguousChild = 'strict $.** ? (@.sourceKind.type() == "array" || @.sourceKind.type() == "object")';
const marked = (metadata: Prisma.Sql) => Prisma.sql`COALESCE(${metadata} @? ${childMarker}::jsonpath, false)`;
const ambiguous = (metadata: Prisma.Sql) => Prisma.sql`COALESCE(${metadata} @? ${ambiguousChild}::jsonpath, false)`;

/** The scoped reader supplies Partner candidates only after authorization and
 * evidence verification. Ordinary facts stay in PostgreSQL throughout. */
export async function readReviewablePage(database: Pick<Prisma.TransactionClient, '$queryRaw'>, input: {
  includeOrdinary: boolean;
  eligibleCommercialIds: string[];
  legacyEligibleStatuses: readonly string[];
  companyTaxReady: boolean;
  partner: PartnerCandidate[];
  now: Date;
  workQueue: boolean;
  skip: number;
  take: number;
}) {
  const order = input.workQueue
    ? Prisma.sql`priority ASC NULLS LAST, "waitingSince" ASC NULLS LAST`
    : Prisma.sql`score DESC`;
  // Bound sums of absolute operands at their finest scale, including item
  // values with 12 decimal places. Under these bounds all intermediate
  // Decimal.js operations are exact at 20 significant digits in any order.
  const [result] = await database.$queryRaw<PageResult[]>(Prisma.sql`
    WITH commercial AS (
      SELECT value AS id FROM jsonb_array_elements_text(${JSON.stringify(input.eligibleCommercialIds)}::jsonb)
    ), contracts AS MATERIALIZED (
      SELECT c.id, c."createdAt", c."signedAt", c."totalAmount", ${ordinaryContractCurrencyMultiplier(Prisma.sql`c.currency`)} AS multiplier,
        ((c."commercialFlowVersion" <> 1 AND c.status::text IN (${Prisma.join(input.legacyEligibleStatuses)}))
          OR commercial.id IS NOT NULL) AS eligible,
        COALESCE(customer."nationalCode", '') <> '' AS customer_tax_ready
      FROM sales_contracts c LEFT JOIN crm_customers customer ON customer.id = c."customerId"
      LEFT JOIN commercial ON commercial.id = c.id
      WHERE ${input.includeOrdinary} AND c."partnerCaseId" IS NULL AND c."partnerKind" IS NULL AND NOT c."isInactive"
    ), owned_payments AS MATERIALIZED (
      SELECT p."contractId", p."receivableId", p.amount, p.metadata
      FROM accounting_payment_statuses p JOIN contracts c ON c.id = p."contractId"
      WHERE p.status IN ('RECEIVED', 'RECONCILED')
    ), linked_receivables AS MATERIALIZED (
      SELECT r.id, r."contractId", r."invoiceRecordId", r.metadata, r.status, r."dueDate",
        (COALESCE(owner."partnerCaseId", '') <> '' OR COALESCE(owner."partnerKind", '') <> '') AS private_contract
      FROM accounting_receivables r LEFT JOIN sales_contracts owner ON owner.id = r."contractId"
      WHERE r."contractId" IN (SELECT id FROM contracts) OR r.id IN (SELECT "receivableId" FROM owned_payments)
    ), owned_tax AS MATERIALIZED (
      SELECT t."contractId", t."invoiceRecordId", t.metadata, t."createdAt", t."submissionStatus"
      FROM accounting_tax_records t JOIN contracts c ON c.id = t."contractId"
    ), owned_flags AS MATERIALIZED (
      SELECT f."contractId", f."sourceFinancialRecordId", f.evidence, f.severity, f."createdAt"
      FROM accounting_contract_flags f JOIN contracts c ON c.id = f."contractId" WHERE f.status = 'OPEN'
    ), owned_corrections AS MATERIALIZED (
      SELECT r."contractId", r."recordId", r."createdAt"
      FROM accounting_correction_requests r JOIN contracts c ON c.id = r."contractId"
      WHERE r.status::text IN (${Prisma.join(ACTIVE_CORRECTION_STATUSES)})
    ), marked_financial AS MATERIALIZED (
      ${accountingMarkedFinancialSources}
    ), private_financial AS MATERIALIZED (
      SELECT f.id FROM accounting_financial_records f LEFT JOIN sales_contracts owner ON owner.id = f."contractId"
      LEFT JOIN marked_financial marked ON marked.id = f.id
      WHERE (f."contractId" IN (SELECT id FROM contracts) OR f.id IN (
        SELECT "invoiceRecordId" FROM linked_receivables UNION ALL SELECT "invoiceRecordId" FROM owned_tax
        UNION ALL SELECT "sourceFinancialRecordId" FROM owned_flags UNION ALL SELECT "recordId" FROM owned_corrections
      )) AND (marked.id IS NOT NULL OR f."sourceKind" = 'PARTNER_INTERNAL_RECORD'
        OR owner."partnerCaseId" IS NOT NULL OR owner."partnerKind" IS NOT NULL)
    ), private_receivables AS MATERIALIZED (
      SELECT r.id FROM linked_receivables r LEFT JOIN private_financial f ON f.id = r."invoiceRecordId"
      WHERE f.id IS NOT NULL OR r.private_contract OR ${marked(Prisma.sql`r.metadata`)}
    ), items AS (
      SELECT i."contractId", SUM(i."totalPrice") AS amount, SUM(ABS(i."totalPrice")) AS bound,
        MAX(min_scale(i."totalPrice")) AS scale
      FROM contract_items i JOIN contracts c ON c.id = i."contractId"
      WHERE i."retiredAt" IS NULL GROUP BY i."contractId"
    ), invoices AS (
      SELECT f."contractId", SUM(f.amount) AS amount, SUM(ABS(f.amount)) AS bound,
        BOOL_OR(f.status IN ('ISSUED', 'POSTED')) AS issued,
        MIN(f."createdAt") FILTER (WHERE f.status NOT IN ('ISSUED', 'POSTED')) AS waiting
      FROM accounting_financial_records f JOIN contracts c ON c.id = f."contractId"
      LEFT JOIN private_financial hidden ON hidden.id = f.id
      WHERE hidden.id IS NULL AND f.kind = 'INVOICE_CANDIDATE' AND f.status <> 'VOIDED' GROUP BY f."contractId"
    ), payments AS (
      SELECT p."contractId", SUM(p.amount) AS amount, SUM(ABS(p.amount)) AS bound
      FROM owned_payments p LEFT JOIN private_receivables hidden ON hidden.id = p."receivableId"
      WHERE hidden.id IS NULL AND NOT ${marked(Prisma.sql`p.metadata`)} GROUP BY p."contractId"
    ), receivables AS (
      SELECT r."contractId", BOOL_OR(r.status <> 'VOIDED') AS present,
        MIN(r."dueDate") FILTER (WHERE r.status NOT IN ('SETTLED', 'VOIDED') AND r."dueDate" < ${input.now}) AS overdue
      FROM linked_receivables r JOIN contracts c ON c.id = r."contractId"
      LEFT JOIN private_receivables hidden ON hidden.id = r.id WHERE hidden.id IS NULL GROUP BY r."contractId"
    ), latest_tax AS (
      SELECT t."contractId", t."submissionStatus", DENSE_RANK() OVER (PARTITION BY t."contractId" ORDER BY t."createdAt" DESC) AS age
      FROM owned_tax t LEFT JOIN private_financial hidden ON hidden.id = t."invoiceRecordId"
      WHERE hidden.id IS NULL AND NOT ${marked(Prisma.sql`t.metadata`)}
    ), taxes AS (
      SELECT "contractId", MIN("submissionStatus"::text) AS status, COUNT(DISTINCT "submissionStatus") = 1 AS safe
      FROM latest_tax WHERE age = 1 GROUP BY "contractId"
    ), flags AS (
      SELECT f."contractId", COUNT(*) AS count, MIN(f."createdAt") FILTER (WHERE f.severity = 'BLOCKER') AS waiting
      FROM owned_flags f LEFT JOIN private_financial hidden ON hidden.id = f."sourceFinancialRecordId"
      WHERE hidden.id IS NULL AND NOT ${marked(Prisma.sql`f.evidence`)} GROUP BY f."contractId"
    ), corrections AS (
      SELECT r."contractId", COUNT(*) AS count, MIN(r."createdAt") AS waiting
      FROM owned_corrections r LEFT JOIN private_financial hidden ON hidden.id = r."recordId"
      WHERE hidden.id IS NULL GROUP BY r."contractId"
    ), facts AS (
      SELECT c.id, c."createdAt", COALESCE(c."signedAt", c."createdAt") AS signed, c.eligible,
        COALESCE(c."totalAmount", i.amount, 0) * c.multiplier AS "contractAmount",
        COALESCE(f.amount, 0) AS "invoicedAmount", COALESCE(p.amount, 0) AS "receivedAmount",
        LEAST(flags.waiting, corrections.waiting) AS blocker, f.waiting AS draft, r.overdue,
        COALESCE(f.issued, false) AS issued, f.waiting IS NULL AND NOT COALESCE(f.issued, false) AS unbilled,
        COALESCE(r.present, false) AS has_receivable,
        COALESCE(t.status = 'NOT_READY', NOT (${input.companyTaxReady} AND c.customer_tax_ready AND i."contractId" IS NOT NULL)) AS tax_missing,
        COALESCE(flags.count, 0) AS flags, COALESCE(corrections.count, 0) AS corrections,
        (COALESCE(t.safe, true) AND COALESCE(f.bound, 0) < 1e18
          AND COALESCE(p.bound, 0) + COALESCE(ABS(c."totalAmount"), i.bound, 0) * c.multiplier
            < power(10::numeric, 20 - CASE WHEN c."totalAmount" IS NULL THEN GREATEST(i.scale, 2) ELSE 2 END)) AS safe
      FROM contracts c LEFT JOIN items i ON i."contractId" = c.id LEFT JOIN invoices f ON f."contractId" = c.id
      LEFT JOIN payments p ON p."contractId" = c.id LEFT JOIN receivables r ON r."contractId" = c.id
      LEFT JOIN taxes t ON t."contractId" = c.id LEFT JOIN flags ON flags."contractId" = c.id
      LEFT JOIN corrections ON corrections."contractId" = c.id
    ), candidates AS MATERIALIZED (
      SELECT id AS "contractId", NULL::int AS "partnerIndex", "createdAt", safe,
        ROUND("contractAmount") AS "contractAmount", ROUND("invoicedAmount") AS "invoicedAmount",
        ROUND("receivedAmount") AS "receivedAmount", ROUND(GREATEST("contractAmount" - "receivedAmount", 0)) AS "remainingAmount",
        (corrections * ${weight.correction} + flags * ${weight.flag} + (overdue IS NOT NULL)::int * ${weight.overdue}
          + tax_missing::int * ${weight.tax} + (eligible AND unbilled)::int * ${weight.unbilled}) AS score,
        -- Match resolveAccountingWorkAttention's precedence before sorting by priority.
        CASE WHEN blocker IS NOT NULL THEN 1 WHEN (eligible AND draft IS NOT NULL) OR overdue IS NOT NULL THEN 2
          WHEN eligible AND unbilled THEN 3 WHEN eligible AND issued AND NOT has_receivable THEN 2
          WHEN eligible AND tax_missing THEN 3 END AS priority,
        CASE WHEN blocker IS NOT NULL THEN blocker WHEN eligible AND draft IS NOT NULL THEN draft
          WHEN overdue IS NOT NULL THEN overdue WHEN eligible AND (unbilled OR issued AND NOT has_receivable OR tax_missing) THEN signed END AS "waitingSince"
      FROM facts
      UNION ALL
      SELECT NULL, p.index, NULL, GREATEST(scale(p."contractAmount"), scale(p."invoicedAmount"),
        scale(p."receivedAmount"), scale(p."remainingAmount")) <= 2,
        p."contractAmount", p."invoicedAmount", p."receivedAmount", p."remainingAmount", p.score, p.priority, p."waitingSince"
      FROM jsonb_to_recordset(${JSON.stringify(input.partner)}::jsonb) AS p(index int, "contractAmount" numeric,
        "invoicedAmount" numeric, "receivedAmount" numeric, "remainingAmount" numeric,
        score bigint, priority int, "waitingSince" timestamp)
    ), page AS (
      SELECT * FROM candidates ORDER BY ${order}, "partnerIndex" ASC NULLS FIRST, "createdAt" DESC, "contractId" ASC
      OFFSET ${input.skip} LIMIT ${input.take}
    ), statistics AS (
      SELECT COUNT(*) AS total, COALESCE(BOOL_AND(safe), true) AND
        COALESCE(SUM(ABS("contractAmount") + ABS("invoicedAmount") + ABS("receivedAmount") + ABS("remainingAmount")), 0) < 1e18
        AND NOT EXISTS (SELECT 1 FROM linked_receivables r WHERE ${ambiguous(Prisma.sql`r.metadata`)}
          UNION ALL SELECT 1 FROM owned_payments p WHERE ${ambiguous(Prisma.sql`p.metadata`)}
          UNION ALL SELECT 1 FROM owned_tax t WHERE ${ambiguous(Prisma.sql`t.metadata`)}
          UNION ALL SELECT 1 FROM owned_flags f WHERE ${ambiguous(Prisma.sql`f.evidence`)}) AS safe,
        COALESCE(SUM("contractAmount"), 0)::text AS "contractAmount",
        COALESCE(SUM("invoicedAmount"), 0)::text AS "invoicedAmount",
        COALESCE(SUM("receivedAmount"), 0)::text AS "receivedAmount",
        COALESCE(SUM("remainingAmount"), 0)::text AS "remainingAmount"
      FROM candidates
    )
    SELECT statistics.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('contractId', "contractId", 'partnerIndex', "partnerIndex")
      ORDER BY ${order}, "partnerIndex" ASC NULLS FIRST, "createdAt" DESC, "contractId" ASC) FROM page), '[]'::jsonb) AS rows
    FROM statistics`);
  return result;
}
