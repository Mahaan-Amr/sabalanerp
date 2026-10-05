import { isPartnerCaseEditableState } from '@sabalanerp/partner-sales-contracts';
import type { Prisma } from '@prisma/client';
export async function readPartnerCommercialEditPermission(tx: Prisma.TransactionClient, contractId: string, actorId: string, now = new Date()) {
  const requests = await tx.accountingCorrectionRequest.findMany({ where: { contractId, status: 'APPROVED_FOR_SALES_EDIT' }, select: { id: true, accountantNote: true } });
  const duty = await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'SALES_CONTRACT_CORRECTION',
    sourceId: { in: requests.map(item => item.id) }, sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION',
    status: 'OPEN', dueAt: { gt: now }, currentAssigneeUserId: actorId } });
  if (!duty) return null;
  const decision = await tx.crossWorkspaceDuty.findFirst({ where: { sourceId: duty.sourceId,
    sourceType: 'SALES_CONTRACT_CORRECTION', sourceActionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION', status: 'COMPLETED' },
    orderBy: { respondedAt: 'desc' } });
  if (!decision?.respondedByUserId || !decision.respondedAt || (decision.structuredResultJson as { actionCode?: string } | null)?.actionCode !== 'APPROVE') return null;
  return { ...duty, accountantNote: requests.find(item => item.id === duty.sourceId)!.accountantNote, managerApprovedBy: decision.respondedByUserId, managerApprovedAt: decision.respondedAt };
}


/** Old seller cancellation also set the administrative flag. Only its exact
 * retained cancellation witness may use the commercial reactivation path. */
export async function partnerInactiveIsCancellation(tx: Prisma.TransactionClient, contract: {
  partnerCaseId: string | null; isInactive: boolean; status: string; inactiveReason: string | null; inactiveAt: Date | null;
}) {
  if (!contract.isInactive) return true;
  if (!contract.partnerCaseId || contract.status !== 'CANCELLED') return false;
  const event = await tx.partnerCaseEvent.findFirst({ where: { caseId: contract.partnerCaseId, type: 'CASE_VOIDED' }, orderBy: { sequence: 'desc' } });
  const fact = (event?.evidence as { publicEvent?: { recordedAt?: string } } | null)?.publicEvent;
  return !!event && contract.inactiveReason === event.reason && !!fact?.recordedAt &&
    contract.inactiveAt?.getTime() === new Date(fact.recordedAt).getTime();
}

/** A finalized Case keeps its state while the approved correction is open.
 * Technical lease/read/write gates must consult the same manager permission
 * as the commercial save; finality alone never grants technical editing. */
export async function partnerTechnicalCaseIsEditable(tx: Prisma.TransactionClient, input: {
  contractId: string; caseState: string; actorId: string;
}) {
  if (isPartnerCaseEditableState(input.caseState)) return true;
  if (input.caseState !== 'COMMITTED') return false;
  const contract = await tx.salesContract.findUnique({ where: { id: input.contractId }, select: {
    isInactive: true, status: true, firstFinancialRecordAt: true, commercialExpiresAt: true,
  } });
  const now = new Date();
  if (!contract || contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status) ||
      (!contract.firstFinancialRecordAt && contract.commercialExpiresAt && contract.commercialExpiresAt <= now)) return false;
  return !!await readPartnerCommercialEditPermission(tx, input.contractId, input.actorId, now);
}
