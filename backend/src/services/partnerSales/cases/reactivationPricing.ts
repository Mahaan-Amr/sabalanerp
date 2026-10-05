import type { Prisma } from '@prisma/client';

/** New inquiry generation starts at reactivation; retained prices are history. */
export async function partnerReactivationAt(tx: Prisma.TransactionClient, caseId: string) {
  const event = await tx.partnerCaseEvent.findFirst({ where: { caseId, type: 'CASE_REACTIVATED' },
    orderBy: { sequence: 'desc' }, select: { recordedAt: true } });
  return event?.recordedAt;
}

export async function inquiryBelongsToCurrentActivation(tx: Prisma.TransactionClient, caseId: string, inquiryId: string) {
  const at = await partnerReactivationAt(tx, caseId);
  if (!at) return true;
  const inquiry = await tx.partnerInquiry.findUnique({ where: { id: inquiryId }, select: { submittedAt: true } });
  return !!inquiry?.submittedAt && inquiry.submittedAt > at;
}
