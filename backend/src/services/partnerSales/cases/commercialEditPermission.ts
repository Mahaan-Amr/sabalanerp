import type { Prisma } from '@prisma/client';
export async function readPartnerCommercialEditPermission(tx: Prisma.TransactionClient, contractId: string, actorId: string, now = new Date()) {
  const requests = await tx.accountingCorrectionRequest.findMany({ where: { contractId, status: 'APPROVED_FOR_SALES_EDIT' }, select: { id: true } });
  return tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'SALES_CONTRACT_CORRECTION',
    sourceId: { in: requests.map(item => item.id) }, sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
    status: 'OPEN', dueAt: { gt: now }, currentAssigneeUserId: actorId } });
}
