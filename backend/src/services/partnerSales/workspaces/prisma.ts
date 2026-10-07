import type { Prisma, PrismaClient } from '@prisma/client';
import { partnerCustomerContractLabel, type PartnerManagementWorkspaceViewV2, type ResponderContractSummaryV2, type Result } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryQuery } from '../inquiries/query';
import { createSavedTechnicalConfigurationResolver } from '../inquiries/adapters';
import type { PartnerInquiryDependencies } from '../inquiries/service';
import { createPrismaManagementWorkspaceReader } from './management';
import { createPartnerWorkspaceQuery } from './query';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { resolvePartnerWorkspaceAuthority } from '../authorization/workspaceAuthority';
import { parseInquiryDefinition } from '../inquiries/definition';

type Transaction = Prisma.TransactionClient;

export function createPrismaPartnerWorkspaceQuery(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
  authorize: PartnerInquiryDependencies['authorize'];
  resolveConfiguration?: PartnerInquiryDependencies['resolveConfiguration'];
  readManagementWorkspace?(transaction: Transaction, page: { cursor?: string; limit: number; section?: 'PROFILES' | 'TRANSFERS'; history?: boolean; transferStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; search?: string; transferId?: string }):
    Promise<Result<PartnerManagementWorkspaceViewV2>>;
}) {
  const resolveConfiguration = input.resolveConfiguration ?? createSavedTechnicalConfigurationResolver();
  const readManagementWorkspace = input.readManagementWorkspace ?? createPrismaManagementWorkspaceReader(input);
  return createPartnerWorkspaceQuery<Transaction>({
    actorId: input.actorId,
    transaction: work => readPartnerSnapshot(input.database, work, { multiRootAuthority: true }),
    async canReadResponderWorkspace(transaction) {
      const authority = await resolvePartnerWorkspaceAuthority(transaction, input.actorId);
      return authority.canViewAssigned || authority.canRespondAssigned || authority.canManageInquiries;
    },
    async listResponderInquiryIds(transaction, page) {
      const authority = await resolvePartnerWorkspaceAuthority(transaction, input.actorId);
      let cursorRank = -1, cursorTime = 0, cursorId = '';
      if (page.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(page.cursor, 'base64url').toString('utf8'));
          if (![0, 1, 2].includes(cursor.rank) || !Number.isFinite(cursor.time) || typeof cursor.id !== 'string') throw new Error('cursor');
          cursorRank = cursor.rank; cursorTime = cursor.time; cursorId = cursor.id;
        } catch { throw new Error('Invalid responder queue cursor'); }
      }
      const search = (page.search ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();
      // Counts and cursors must obey the same root policy as the selected details.
      // Feature/assignment eligibility alone does not override a central denial.
      const candidates = await transaction.partnerInquiry.findMany({ where: {
        assignments: { some: authority.canManageInquiries ? {} : { responderId: input.actorId } },
      }, select: { id: true, profileId: true, profile: { select: { userId: true } }, rows: { select: { id: true, definition: true } } }, orderBy: { id: 'asc' } });
      const readableIds: string[] = [];
      const paidRowIds: string[] = [];
      const rollout = new Map<string, boolean>();
      for (const candidate of candidates) {
        const allowed = await input.authorize(transaction, { actorId: input.actorId, action: 'INQUIRY_READ',
          purpose: 'RESPONDER', root: { kind: 'INQUIRY', id: candidate.id } });
        if (!allowed.ok) continue;
        if (!rollout.has(candidate.profileId)) rollout.set(candidate.profileId,
          (await authorizePartnerTechnicalRollout(transaction, candidate.profileId, 'READ')).ok);
        if (!rollout.get(candidate.profileId)) continue;
        readableIds.push(candidate.id);
        const definitions = candidate.rows.map(row => ({ row, definition: parseInquiryDefinition(row.definition) }));
        for (const { row, definition } of definitions) {
          if (!definition) continue;
          const resolved = await resolveConfiguration(transaction,
            { actorId: candidate.profile.userId, reference: definition.configurationRef });
          if (resolved.ok && resolved.value.paidSourceProductRowId && definitions.some(parent =>
              parent.definition?.configurationRef.productRowId === resolved.value.paidSourceProductRowId &&
              parent.definition?.configurationRef.recoveryId === definition.configurationRef.recoveryId &&
              parent.definition?.configurationRef.recoveryRevision === definition.configurationRef.recoveryRevision)) paidRowIds.push(row.id);
        }
      }
      const groups = await transaction.$queryRaw<Array<{
        groupId: string | null; inquiryIds: string[]; summary: { customer: string; partnerDisplayName: string; contractNumber: string | null; trackingNumber: number | null; pending: boolean; requestedAt: string; answeredAt: string | null; answeredRows: number; currentRows: number; cancelled: boolean } | null; pending: number; answered: number; history: number; rank: number; sortTime: number;
      }>>`
        WITH eligible AS (
          SELECT i.id, COALESCE(i."caseId", i.id) AS "groupId",
            COALESCE(NULLIF(customer."companyName", ''), NULLIF(trim(concat_ws(' ', customer."firstName", customer."lastName")), ''), 'نام مشتری ثبت نشده') AS customer,
            trim(concat_ws(' ', u."firstName", u."lastName")) AS "partnerDisplayName",
            sc."contractNumber", tc.number AS "trackingNumber"
          FROM partner_inquiries i
          JOIN partner_profiles p ON p.id = i."profileId"
          JOIN users u ON u.id = p."userId"
          LEFT JOIN partner_sale_cases c ON c.id = i."caseId"
          LEFT JOIN sales_contracts sc ON sc.id = c."customerContractId"
          LEFT JOIN partner_case_tracking_codes tc ON tc."caseId" = c.id
          LEFT JOIN crm_customers customer ON customer.id = c."customerId"
          WHERE i.id = ANY(${readableIds}::text[]) AND (${page.contractId ?? ''} = '' OR COALESCE(i."caseId", i.id) = ${page.contractId ?? ''})
            AND (${authority.canManageInquiries} OR EXISTS (
            SELECT 1 FROM partner_inquiry_assignments a WHERE a."inquiryId" = i.id
              AND a."responderId" = ${input.actorId}
              AND a.revision = (SELECT max(current.revision) FROM partner_inquiry_assignments current WHERE current."inquiryId" = i.id)
          )) AND (${search} = '' OR concat_ws(' ', c."caseNumber", sc."contractNumber", tc.number::text,
            u."firstName", u."lastName", customer."firstName", customer."lastName", customer."companyName") ILIKE '%' || ${search} || '%')
        ), grouped AS (
          SELECT e."groupId", array_agg(DISTINCT e.id ORDER BY e.id) AS "inquiryIds",
            min(e.customer) AS customer, min(e."partnerDisplayName") AS "partnerDisplayName",
            min(e."contractNumber") AS "contractNumber", min(e."trackingNumber") AS "trackingNumber",
            count(*) FILTER (WHERE successor.id IS NULL)::int AS "currentRows",
            count(*) FILTER (WHERE successor.id IS NULL AND r.outcome IN ('APPROVED', 'REJECTED'))::int AS "answeredRows",
            min(r."submittedAt") AS "firstSubmittedAt",
            bool_or(r.outcome = 'PENDING' AND successor.id IS NULL) AS pending,
            bool_or(successor.id IS NULL AND r.outcome IN ('REJECTED', 'APPROVED')) AS answered,
            bool_or(successor.id IS NULL AND r.outcome = 'APPROVED' AND approval."expiresAt" > CURRENT_TIMESTAMP) AS approved,
            bool_or(successor.id IS NULL AND r.outcome = 'REJECTED') AS rejected,
            bool_or(successor.id IS NULL AND r.outcome = 'APPROVED' AND approval."expiresAt" <= CURRENT_TIMESTAMP) AS expired,
            bool_or(r.outcome = 'CANCELLED') AS cancelled,
            bool_or(successor.id IS NOT NULL) AS superseded,
            min(r."submittedAt") FILTER (WHERE r.outcome = 'PENDING' AND successor.id IS NULL) AS "requestedAt",
            max(COALESCE(approval."approvedAt", decision."answeredAt", r."submittedAt")) FILTER (WHERE successor.id IS NULL AND r.outcome IN ('APPROVED', 'REJECTED')) AS "answeredAt",
            bool_or(successor.id IS NOT NULL OR r.outcome = 'CANCELLED' OR
              (r.outcome = 'APPROVED' AND approval."expiresAt" <= CURRENT_TIMESTAMP)) AS history
          FROM eligible e JOIN partner_inquiry_rows r ON r."inquiryId" = e.id AND NOT (r.id = ANY(${paidRowIds}::text[]))
          LEFT JOIN partner_inquiry_rows successor ON successor."predecessorId" = r.id
          LEFT JOIN partner_inquiry_approvals approval ON approval."rowId" = r.id
          LEFT JOIN LATERAL (
            SELECT max(event."recordedAt") AS "answeredAt" FROM partner_inquiry_events event
            WHERE event."inquiryId" = e.id AND event.type IN ('INQUIRY_DECIDED', 'INQUIRY_PARTIALLY_DECIDED')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(event.evidence->'decisions', '[]'::jsonb)) item WHERE item->>'rowId' = r.id)
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(event.evidence->'batch'->'outcomes', '[]'::jsonb)) item WHERE item->>'rowId' = r.id AND item->>'ok' = 'true')
          ) decision ON true
          GROUP BY e."groupId"
        ), filtered AS (
          SELECT * FROM grouped WHERE CASE ${page.status ?? 'all'}
            WHEN 'approved' THEN approved WHEN 'rejected' THEN rejected WHEN 'expired' THEN expired
            WHEN 'cancelled' THEN cancelled WHEN 'superseded' THEN superseded ELSE true END
        ), counted AS (
          SELECT *, CASE WHEN pending THEN 0 WHEN answered THEN 1 ELSE 2 END AS rank,
            floor(EXTRACT(EPOCH FROM COALESCE(CASE WHEN pending THEN "requestedAt" ELSE "answeredAt" END, 'epoch'::timestamptz)) * 1000)
              * CASE WHEN pending THEN 1 ELSE -1 END AS "sortTime",
            (SELECT count(*)::int FROM filtered WHERE pending) AS "pendingCount",
            (SELECT count(*)::int FROM filtered WHERE answered AND NOT pending) AS "answeredCount",
            (SELECT count(*)::int FROM filtered WHERE history) AS "historyCount"
          FROM filtered WHERE CASE ${page.view ?? 'all'}
            WHEN 'pending' THEN pending WHEN 'answered' THEN answered AND NOT pending WHEN 'history' THEN history ELSE true END
        )
        , selected AS (
          SELECT "groupId", "inquiryIds", "pendingCount" AS pending, "answeredCount" AS answered, "historyCount" AS history,
            rank, "sortTime"::double precision AS "sortTime",
            jsonb_build_object('customer', customer, 'partnerDisplayName', "partnerDisplayName",
              'contractNumber', "contractNumber", 'trackingNumber', "trackingNumber", 'pending', pending,
              'requestedAt', COALESCE("requestedAt", "firstSubmittedAt"), 'answeredAt', "answeredAt",
              'currentRows', "currentRows", 'answeredRows', "answeredRows", 'cancelled', cancelled) AS summary
          FROM counted WHERE (${cursorRank} = -1 OR (rank, "sortTime", "groupId") > (${cursorRank}, ${cursorTime}::numeric, ${cursorId}))
          ORDER BY rank, "sortTime", "groupId" LIMIT ${page.limit + 1}
        )
        SELECT * FROM selected UNION ALL
        SELECT NULL::text AS "groupId", ARRAY[]::text[] AS "inquiryIds",
          (SELECT count(*)::int FROM filtered WHERE pending),
          (SELECT count(*)::int FROM filtered WHERE answered AND NOT pending),
          (SELECT count(*)::int FROM filtered WHERE history), 0::int, 0::double precision, NULL::jsonb AS summary
        WHERE NOT EXISTS (SELECT 1 FROM selected)
        ORDER BY rank, "sortTime", "groupId"`;
      // An empty selected tab still needs the authorized counts of other tabs.
      // The common read above keeps full inquiry details outside unselected pages.
      const selected = groups.filter(group => group.groupId !== null).slice(0, page.limit);
      const contracts: ResponderContractSummaryV2[] = selected.map(group => {
        const summary = group.summary!;
        return { id: group.groupId!, customer: summary.customer, partnerDisplayName: summary.partnerDisplayName,
          label: summary.contractNumber ? `شماره قرارداد ${partnerCustomerContractLabel('', summary.contractNumber)}`
            : summary.trackingNumber ? `کد پیگیری ${summary.trackingNumber.toLocaleString('fa-IR', { useGrouping: false })}` : 'استعلام همکار',
          pending: summary.pending, requestedAt: new Date(summary.requestedAt).toISOString(),
          ...(summary.answeredAt ? { answeredAt: new Date(summary.answeredAt).toISOString() } : {}),
          answeredRows: summary.answeredRows, currentRows: summary.currentRows, cancelled: summary.cancelled };
      });
      return { grouped: true, inquiryIds: selected.flatMap(group => group.inquiryIds),
        ...(!page.contractId ? { contracts } : {}),
        ...(groups.length > page.limit ? { nextCursor: Buffer.from(JSON.stringify({ rank: selected.at(-1)!.rank,
          time: selected.at(-1)!.sortTime, id: selected.at(-1)!.groupId })).toString('base64url') } : {}),
        ...(groups[0] ? { contractCounts: { pending: groups[0].pending, answered: groups[0].answered, history: groups[0].history } } : {}) };

    },
    readResponderInquiry(transaction, inquiryId) {
      const query = createPartnerInquiryQuery({ actorId: input.actorId,
        transaction: work => work(transaction), authorize: input.authorize,
        resolveConfiguration } as PartnerInquiryDependencies);
      return query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId });
    },
    readManagementWorkspace,
  });
}
