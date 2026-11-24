import { Prisma } from '@prisma/client';

const documentQueueStates = ['READY', 'BLOCKED', 'ISSUED'] as const;
export type DispatchDocumentQueueState = typeof documentQueueStates[number];
export const isDispatchDocumentQueueState = (value: unknown): value is DispatchDocumentQueueState =>
  documentQueueStates.some(state => state === value);

type QueueCandidate = {
  id: string;
  loadingId: string;
  allocationRevisionId: string;
  canManage: boolean;
  status: string;
  waybills: Array<{ id: string }>;
};

const record = (value: unknown): Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown, fallback: string) => value == null ? fallback : String(value);

/** Returns the same finalized identity and all-or-unknown price as the combined document read model. */
export async function readDispatchDocumentQueueSummary(
  tx: Prisma.TransactionClient,
  ordered: QueueCandidate[],
  snapshots: ReadonlyMap<string, unknown>,
  requested: { state: DispatchDocumentQueueState | 'GROUP'; page: number; pageSize: number },
) {
  const queue = ordered.flatMap(row => {
    const waybillId = row.waybills.at(-1)?.id;
    const state: DispatchDocumentQueueState | undefined = waybillId ? 'ISSUED' : row.status === 'PENDING' ? 'READY'
      : ['STALE_REQUIRES_SUCCESSOR', 'EVIDENCE_CONFLICT'].includes(row.status) ? 'BLOCKED' : undefined;
    return state ? [{ row, state, waybillId }] : [];
  });
  const counts = { READY: 0, BLOCKED: 0, ISSUED: 0 };
  for (const { state } of queue) counts[state]++;
  const group = requested.state === 'GROUP';
  const matching = group ? queue : queue.filter(row => row.state === requested.state);
  const page = Math.min(requested.page, Math.max(1, Math.ceil(matching.length / requested.pageSize)));
  const start = (page - 1) * requested.pageSize;
  const selected = group ? matching : matching.slice(start, start + requested.pageSize);
  const selectedIds = new Set(selected.map(({ row }) => row.id));
  const loadingIds = new Set(selected.map(({ row }) => row.loadingId));
  const related = group ? [] : queue.filter(({ row }) => loadingIds.has(row.loadingId) && !selectedIds.has(row.id));
  const revisionIds = [...new Set([...selected, ...related].map(({ row }) => row.allocationRevisionId))];

  const totals = revisionIds.length ? await tx.$queryRaw<Array<{ revisionId: string; amount: string | null; currency: string | null }>>`
    SELECT revision.id AS "revisionId",
      tally.amount,
      (
        SELECT version.currency
        FROM logistics_allocation_revision_pricing reference
        JOIN contract_approved_pricing_versions version ON version.id = reference."pricingVersionId"
        WHERE reference."allocationRevisionId" = revision.id
        ORDER BY reference.id ASC LIMIT 1
      ) AS currency
    FROM logistics_allocation_revisions revision
    CROSS JOIN LATERAL (
      SELECT CASE WHEN COUNT(*) > 0 AND COUNT(event.id) = COUNT(*) THEN SUM(event."netAmount")::text END AS amount
      FROM logistics_allocation_revision_lines line
      LEFT JOIN dispatch_priced_allocation_events event
        ON event."allocationRevisionLineId" = line.id AND event."allocationRevisionId" = line."revisionId"
      WHERE line."revisionId" = revision.id
    ) tally
    WHERE revision.id IN (${Prisma.join(revisionIds)})
  ` : [];
  const totalsByRevision = new Map(totals.map(total => [total.revisionId, total]));
  const project = ({ row, state, waybillId }: typeof queue[number]) => {
    const loading = record(record(snapshots.get(row.id)).loading);
    const customer = record(loading.customer);
    const project = record(loading.project);
    const total = totalsByRevision.get(row.allocationRevisionId);
    return {
      id: row.id, loadingId: row.loadingId, waybillId, canManage: row.canManage, state,
      customerName: text(customer.companyName, text(customer.name, 'مشتری در تصویر ثابت ثبت نشده')),
      destination: text(project.address, text(project.name, 'مقصد در تصویر ثابت ثبت نشده')),
      loadingNumber: text(loading.number, 'بارگیری ثبت‌شده'),
      total: { amount: total?.amount ?? 'UNKNOWN', currency: total?.currency ?? 'IRR' },
    };
  };
  return {
    rows: selected.map(project),
    ...(group ? {} : { relatedRows: related.map(project), counts, page, pageSize: requested.pageSize }),
  };
}
