import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ContractRuntime, Result } from '../partnerSales/notifications/contracts';

export interface PartnerUnavailableResponderSource {
  /** Source owner locks the inquiry/assignment and checks current eligibility.
   * Return null when pending work no longer needs intervention. Handler IDs
   * must come from central PARTNER_RESPONDER_REASSIGN scope, never all Sales. */
  lockUnavailable(tx: Prisma.TransactionClient, sourceEvidenceId: string): Promise<{
    inquiryId: string;
    assignmentRevision: number;
    reporterUserId: string;
    handlerUserIds: readonly string[];
  } | null>;
}

/** The support task IS an existing SupportTicket, not a second price-response
 * queue or duplicated CrossWorkspaceDuty. Reassignment stays in the inquiry
 * owner; support closure alone never grants authority or changes assignment. */
export function createPartnerSupportDutyAdapter(
  contract: ContractRuntime, database: PrismaClient, source: PartnerUnavailableResponderSource,
) {
  return {
    async ensureUnavailable(sourceEvidenceId: string): Promise<Result<{ referenceCode: string; href: string } | null>> {
      try {
        contract.IdSchema.parse(sourceEvidenceId);
        return await database.$transaction(async tx => {
          const unavailable = await source.lockUnavailable(tx, sourceEvidenceId);
          if (!unavailable) return { ok: true as const, value: null };
          contract.IdSchema.parse(unavailable.inquiryId);
          if (!Number.isSafeInteger(unavailable.assignmentRevision) || unavailable.assignmentRevision < 1) {
            throw new Error('PARTNER_SUPPORT_SOURCE_INVALID');
          }
          const key = await contract.canonicalHash({
            purpose: 'PARTNER_RESPONDER_UNAVAILABLE', schemaVersion: 1,
            inquiryId: unavailable.inquiryId, assignmentRevision: unavailable.assignmentRevision,
          });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          const existing = await tx.supportTicket.findUnique({ where: { idempotencyKey: key } });
          if (existing) return { ok: true as const, value: {
            referenceCode: existing.referenceCode, href: `/dashboard/support/tickets/${existing.id}`,
          } };
          const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
          const ticket = await tx.supportTicket.create({ data: {
            idempotencyKey: key, reporterId: unavailable.reporterUserId,
            referenceCode: `SUP-${clock.now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(6).toString('hex').toUpperCase()}`,
            title: 'تعیین پاسخ‌دهنده استعلام', type: 'ACCESS_PROBLEM', impact: 'BLOCKED',
            workaroundExists: false, reportedWorkspace: 'sales',
            originRoute: '/dashboard/personal/notifications', suggestedPriority: 'HIGH',
            diagnosticSnapshot: { source: 'PARTNER_RESPONDER_UNAVAILABLE', trackingKey: key },
            effectiveAccessSnapshot: { source: 'PARTNER_CENTRAL_AUTHORIZATION', capturedAt: clock.now.toISOString() },
            entries: { create: { kind: 'REPORT', body: 'پاسخ‌دهنده فعلی امکان پاسخ‌گویی ندارد. مسئول مجاز فروش باید پاسخ‌دهنده جدید تعیین کند.' } },
            participants: { create: [...new Set(unavailable.handlerUserIds)].map(userId => ({ userId, role: 'HANDLER' })) },
            auditEvents: { create: { action: 'CREATED', afterData: { cause: 'RESPONDER_UNAVAILABLE', trackingKey: key } } },
          } });
          return { ok: true as const, value: { referenceCode: ticket.referenceCode, href: `/dashboard/support/tickets/${ticket.id}` } };
        });
      } catch {
        return { ok: false, error: contract.partnerError('INTEGRITY_CONFLICT') };
      }
    },
  };
}
