import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { reconcilePartnerPricingDuty } from '../../crossWorkspaceDutyAdapters/partnerPricingDutyAdapter';

/** Caller owns the Case lock. Close outstanding work atomically with cancellation,
 * retaining answered prices and reasons as immutable historical evidence. */
export async function cancelPartnerCaseInquiries(tx: Prisma.TransactionClient, input: {
  caseId: string; actorId: string; commandId: string; correlationId: string; reason: string; now: Date;
}) {
  const inquiries = await tx.partnerInquiry.findMany({ where: { caseId: input.caseId }, orderBy: { id: 'asc' },
    select: { id: true } });
  for (const inquiry of inquiries) {
    await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${inquiry.id} FOR UPDATE`;
    const pending = await tx.partnerInquiryRow.findMany({ where: { inquiryId: inquiry.id, outcome: 'PENDING' },
      select: { id: true } });
    if (pending.length) {
      await tx.partnerInquiryRow.updateMany({ where: { id: { in: pending.map(row => row.id) } },
        data: { outcome: 'CANCELLED', revision: { increment: 1 } } });
      const next = await tx.partnerInquiry.update({ where: { id: inquiry.id },
        data: { revision: { increment: 1 }, pricingReadyAt: null, pricingExpiresAt: null }, select: { revision: true } });
      const assignment = await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: inquiry.id },
        orderBy: { revision: 'desc' }, select: { id: true, revision: true, responderId: true } });
      await tx.partnerInquiryEvent.create({ data: { id: randomUUID(), inquiryId: inquiry.id, revision: next.revision,
        actorId: input.actorId, commandId: `${input.commandId}:inquiry:${inquiry.id}`, correlationId: input.correlationId,
        type: 'INQUIRY_CANCELLED', reason: input.reason, recordedAt: input.now,
        evidence: { version: 1, caseId: input.caseId, rowIds: pending.map(row => row.id),
          ...(assignment ? { assignmentId: assignment.id, assignmentRevision: assignment.revision,
            responderId: assignment.responderId } : {}) } } });
    }
    await reconcilePartnerPricingDuty(tx, { inquiryId: inquiry.id, actorUserId: input.actorId, cancelled: true, now: input.now });
  }
}
