import type { Prisma, PrismaClient } from '@prisma/client';
import type { ContractRuntime, NotificationGateway } from './contracts';
import { inquiryNoticeKinds } from './contracts';
import { PARTNER_NOTIFICATION_RESOURCE, type PartnerNotificationAccess } from './access';
import { publishNotificationEvent } from '../../notificationService';

/** Uses the existing application client and notification/event/outbox schema.
 * Each call is its own transaction AFTER the committed inquiry cause. */
export function createPartnerInAppGateway(
  contract: ContractRuntime, database: PrismaClient | Prisma.TransactionClient, access: PartnerNotificationAccess,
): NotificationGateway {
  return {
    async enqueue(input) {
      const parsed = contract.SafeNotificationSchema.safeParse(input);
      if (!parsed.success || input.kind.startsWith('CUSTOMER_') || input.kind === 'RESPONDER_UNAVAILABLE') {
        return { ok: false, error: contract.partnerError('INVALID_PAYLOAD') };
      }
      const notification = parsed.data;
      try {
        const run = async (tx: Prisma.TransactionClient) => {
          const key = `partner-notification-v1:${notification.notificationId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
          const previous = await tx.notificationEvent.findUnique({
            where: { deduplicationKey: key }, include: { notifications: { select: { userId: true } } },
          });
          if (previous && contract.canonicalJson(previous.payload) !== contract.canonicalJson(notification)) {
            return { ok: false as const, error: contract.partnerError('IDEMPOTENCY_CONFLICT') };
          }
          const evidence = await access.lockAndAuthorize(tx, notification);
          if (!evidence) return { ok: false as const, error: contract.partnerError('NOT_FOUND') };
          if (contract.canonicalJson(evidence.notification) !== contract.canonicalJson(notification)
            || inquiryNoticeKinds[evidence.type] !== notification.kind) {
            return { ok: false as const, error: contract.partnerError('INTEGRITY_CONFLICT') };
          }
          const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
          if (clock.now.toISOString() < notification.notBefore) {
            return { ok: false as const, error: contract.partnerError('STATE_CONFLICT') };
          }
          const user = await tx.user.findUnique({ where: { id: evidence.recipientUserId }, select: { isActive: true } });
          if (!user?.isActive) return { ok: false as const, error: contract.partnerError('NOT_FOUND') };
          if (previous) {
            if (previous.notifications.length !== 1 || previous.notifications[0].userId !== evidence.recipientUserId) {
              return { ok: false as const, error: contract.partnerError('IDEMPOTENCY_CONFLICT') };
            }
            return { ok: true as const, value: { deliveryId: previous.id, mode: 'LIVE' as const } };
          }
          const event = await publishNotificationEvent(tx, {
            type: `PARTNER_INQUIRY_${evidence.type}`, deduplicationKey: key,
            recipientIds: [evidence.recipientUserId], resourceType: PARTNER_NOTIFICATION_RESOURCE,
            // Opaque evidence stays internal; the notification list has neither
            // this ID nor an inquiry/customer/Case ID in its reference/link.
            resourceId: notification.projectionEvidenceId, referenceId: null,
            actionUrl: '/dashboard/personal/notifications', payload: notification,
          });
          if (!event) throw new Error('PARTNER_NOTIFICATION_NOT_CREATED');
          return { ok: true as const, value: { deliveryId: event.id, mode: 'LIVE' as const } };
        };
        return typeof (database as PrismaClient).$transaction === 'function'
          ? await (database as PrismaClient).$transaction(run)
          : await run(database as Prisma.TransactionClient);
      } catch {
        // No raw database, validator, authorization or economic evidence logs.
        // The committed cause remains retryable at the source outbox owner.
        return { ok: false, error: contract.partnerError('INTEGRITY_CONFLICT') };
      }
    },
  };
}
