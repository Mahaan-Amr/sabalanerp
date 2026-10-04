import type { Prisma, PrismaClient } from '@prisma/client';
import type { PartnerManagementWorkspaceViewV2, Result } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryQuery } from '../inquiries/query';
import { resolveSavedTechnicalConfiguration } from '../inquiries/adapters';
import type { PartnerInquiryDependencies } from '../inquiries/service';
import { createPrismaManagementWorkspaceReader } from './management';
import { createPartnerWorkspaceQuery } from './query';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { resolvePartnerWorkspaceAuthority } from '../authorization/workspaceAuthority';

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
  const readManagementWorkspace = input.readManagementWorkspace ?? createPrismaManagementWorkspaceReader(input);
  return createPartnerWorkspaceQuery<Transaction>({
    actorId: input.actorId,
    transaction: work => readPartnerSnapshot(input.database, work, { multiRootAuthority: true }),
    async listResponderInquiryIds(transaction, page) {
      const authority = await resolvePartnerWorkspaceAuthority(transaction, input.actorId);
      const search = (page.search ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();
      // Counts and cursors must obey the same root policy as the selected details.
      // Feature/assignment eligibility alone does not override a central denial.
      const candidates = await transaction.partnerInquiry.findMany({ where: {
        assignments: { some: authority.canManageInquiries ? {} : { responderId: input.actorId } },
      }, select: { id: true, profileId: true }, orderBy: { id: 'asc' } });
      const readableIds: string[] = [];
      const rollout = new Map<string, boolean>();
      for (const candidate of candidates) {
        const allowed = await input.authorize(transaction, { actorId: input.actorId, action: 'INQUIRY_READ',
          purpose: 'RESPONDER', root: { kind: 'INQUIRY', id: candidate.id } });
        if (!allowed.ok) continue;
        if (!rollout.has(candidate.profileId)) rollout.set(candidate.profileId,
          (await authorizePartnerTechnicalRollout(transaction, candidate.profileId, 'READ')).ok);
        if (rollout.get(candidate.profileId)) readableIds.push(candidate.id);
      }
      const groups = await transaction.$queryRaw<Array<{
        groupId: string | null; inquiryIds: string[]; pending: number; answered: number; history: number;
      }>>`
        WITH eligible AS (
          SELECT i.id, COALESCE(i."caseId", i.id) AS "groupId"
          FROM partner_inquiries i
          JOIN partner_profiles p ON p.id = i."profileId"
          JOIN users u ON u.id = p."userId"
          LEFT JOIN partner_sale_cases c ON c.id = i."caseId"
          LEFT JOIN sales_contracts sc ON sc.id = c."customerContractId"
          LEFT JOIN partner_case_tracking_codes tc ON tc."caseId" = c.id
          WHERE i.id = ANY(${readableIds}::text[]) AND (${authority.canManageInquiries} OR EXISTS (
            SELECT 1 FROM partner_inquiry_assignments a WHERE a."inquiryId" = i.id
              AND a."responderId" = ${input.actorId}
              AND a.revision = (SELECT max(current.revision) FROM partner_inquiry_assignments current WHERE current."inquiryId" = i.id)
          )) AND (${search} = '' OR concat_ws(' ', c."caseNumber", sc."contractNumber", tc.number::text,
            u."firstName", u."lastName") ILIKE '%' || ${search} || '%')
        ), grouped AS (
          SELECT e."groupId", array_agg(DISTINCT e.id ORDER BY e.id) AS "inquiryIds",
            bool_or(r.outcome = 'PENDING' AND successor.id IS NULL) AS pending,
            bool_or(successor.id IS NULL AND (r.outcome = 'REJECTED' OR
              (r.outcome = 'APPROVED' AND approval."expiresAt" > CURRENT_TIMESTAMP))) AS answered,
            bool_or(successor.id IS NOT NULL OR r.outcome = 'CANCELLED' OR
              (r.outcome = 'APPROVED' AND approval."expiresAt" <= CURRENT_TIMESTAMP)) AS history
          FROM eligible e JOIN partner_inquiry_rows r ON r."inquiryId" = e.id
          LEFT JOIN partner_inquiry_rows successor ON successor."predecessorId" = r.id
          LEFT JOIN partner_inquiry_approvals approval ON approval."rowId" = r.id
          GROUP BY e."groupId"
        ), counted AS (
          SELECT *, (SELECT count(*)::int FROM grouped WHERE pending) AS "pendingCount",
            (SELECT count(*)::int FROM grouped WHERE answered AND NOT pending) AS "answeredCount",
            (SELECT count(*)::int FROM grouped WHERE history) AS "historyCount"
          FROM grouped WHERE CASE ${page.view ?? 'pending'}
            WHEN 'pending' THEN pending WHEN 'answered' THEN answered AND NOT pending ELSE history END
        )
        , selected AS (
          SELECT "groupId", "inquiryIds", "pendingCount" AS pending, "answeredCount" AS answered, "historyCount" AS history
          FROM counted WHERE (${page.cursor ?? ''} = '' OR "groupId" > ${page.cursor ?? ''})
          ORDER BY "groupId" LIMIT 6
        )
        SELECT * FROM selected UNION ALL
        SELECT NULL::text AS "groupId", ARRAY[]::text[] AS "inquiryIds",
          (SELECT count(*)::int FROM grouped WHERE pending),
          (SELECT count(*)::int FROM grouped WHERE answered AND NOT pending),
          (SELECT count(*)::int FROM grouped WHERE history)
        WHERE NOT EXISTS (SELECT 1 FROM selected)`;
      // An empty selected tab still needs the authorized counts of other tabs.
      // The common read above keeps full inquiry details outside unselected pages.
      const selected = groups.filter(group => group.groupId !== null).slice(0, 5);
      return { grouped: true, inquiryIds: selected.flatMap(group => group.inquiryIds),
        ...(groups.length > 5 ? { nextCursor: selected.at(-1)!.groupId! } : {}),
        ...(groups[0] ? { contractCounts: { pending: groups[0].pending, answered: groups[0].answered, history: groups[0].history } } : {}) };

    },
    readResponderInquiry(transaction, inquiryId) {
      const query = createPartnerInquiryQuery({ actorId: input.actorId,
        transaction: work => work(transaction), authorize: input.authorize,
        resolveConfiguration: input.resolveConfiguration ?? resolveSavedTechnicalConfiguration } as PartnerInquiryDependencies);
      return query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId });
    },
    readManagementWorkspace,
  });
}
