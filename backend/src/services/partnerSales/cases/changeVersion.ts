import type { Prisma } from '@prisma/client';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';

/** Scalar metadata only: no projections, graph JSON, prices or per-Case locks.
 * Authorization is refreshed by the transport before every call. */
export async function readPartnerCaseChangeVersion(tx: Prisma.TransactionClient, profileId: string,
  authorizationRevision: number, caseId?: string, profileLifecycle?: { revision: number; state: string }) {
  const cases = await tx.partnerSaleCase.findMany({ where: { profileId, ...(caseId ? { id: caseId } : {}) },
    orderBy: { id: 'asc' }, select: { id: true, stateRevision: true, headRevision: true, integrityHash: true,
      customerContract: { select: { updatedAt: true, commercialExpiresAt: true, firstFinancialRecordAt: true } },
      pricingInquiries: { orderBy: { id: 'asc' }, select: { id: true, revision: true,
        rows: { orderBy: { id: 'asc' }, select: { id: true, revision: true, outcome: true } } } } } });
  const expiredApprovals = await tx.partnerInquiryApproval.count({ where: { expiresAt: { lte: new Date() },
    row: { inquiry: { profileId, caseId: caseId ?? { not: null } } } } });
  const now = Date.now();
  return canonicalHash(JSON.parse(JSON.stringify({ profileId, profileLifecycle, authorizationRevision, expiredApprovals, cases: cases.map(row => ({ ...row,
    contractExpired: !!row.customerContract?.commercialExpiresAt && !row.customerContract.firstFinancialRecordAt &&
      row.customerContract.commercialExpiresAt.getTime() <= now })) })));
}
