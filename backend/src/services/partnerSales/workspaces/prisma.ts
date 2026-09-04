import type { Prisma, PrismaClient } from '@prisma/client';
import type { PartnerManagementWorkspaceViewV2, Result } from '@sabalanerp/partner-sales-contracts';
import { createPartnerInquiryQuery } from '../inquiries/query';
import type { PartnerInquiryDependencies } from '../inquiries/service';
import { createPrismaManagementWorkspaceReader } from './management';
import { createPartnerWorkspaceQuery } from './query';
import { readPartnerSnapshot } from '../authorization/readSnapshot';

type Transaction = Prisma.TransactionClient;

export function createPrismaPartnerWorkspaceQuery(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
  authorize: PartnerInquiryDependencies['authorize'];
  readManagementWorkspace?(transaction: Transaction, page: { cursor?: string; limit: number }):
    Promise<Result<PartnerManagementWorkspaceViewV2>>;
}) {
  const readManagementWorkspace = input.readManagementWorkspace ?? createPrismaManagementWorkspaceReader(input);
  return createPartnerWorkspaceQuery<Transaction>({
    actorId: input.actorId,
    transaction: work => readPartnerSnapshot(input.database, work),
    async listResponderInquiryIds(transaction, page) {
      const take = Math.min(page.limit * 4 + 1, 401);
      const rows = page.cursor
        ? await transaction.$queryRaw<Array<{ inquiryId: string }>>`
          SELECT a."inquiryId"
          FROM partner_inquiry_assignments a
          WHERE a."responderId" = ${input.actorId}
            AND a."inquiryId" > ${page.cursor}
            AND a.revision = (SELECT max(current.revision)
              FROM partner_inquiry_assignments current WHERE current."inquiryId" = a."inquiryId")
          ORDER BY a."inquiryId" ASC
          LIMIT ${take}`
        : await transaction.$queryRaw<Array<{ inquiryId: string }>>`
          SELECT a."inquiryId"
          FROM partner_inquiry_assignments a
          WHERE a."responderId" = ${input.actorId}
            AND a.revision = (SELECT max(current.revision)
              FROM partner_inquiry_assignments current WHERE current."inquiryId" = a."inquiryId")
          ORDER BY a."inquiryId" ASC
          LIMIT ${take}`;
      return { inquiryIds: rows.slice(0, take - 1).map(row => row.inquiryId), hasMore: rows.length === take };
    },
    readResponderInquiry(transaction, inquiryId) {
      const query = createPartnerInquiryQuery({ actorId: input.actorId,
        transaction: work => work(transaction), authorize: input.authorize } as PartnerInquiryDependencies);
      return query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId });
    },
    readManagementWorkspace,
  });
}
