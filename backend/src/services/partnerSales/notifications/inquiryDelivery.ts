import type { Prisma, PrismaClient } from '@prisma/client';
import * as PartnerContracts from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerAuthorizationV2 } from '../authorization/prisma';
import { resolvePartnerScopedAuthority } from '../authorization/centralAuthority';
import { createPartnerInAppGateway } from './gateway';
import { planInquiryNotifications, type InquiryNotificationCause } from './inquiries';
import type { ContractRuntime, NotificationGateway, SafeNotification } from './contracts';
import type { PartnerNotificationAccess, PartnerNotificationEvidence } from './access';

type Evidence = Record<string, unknown>;

function object(value: unknown): Evidence | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Evidence : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function readEvent(database: Prisma.TransactionClient | PrismaClient, eventId: string) {
  return database.partnerInquiryEvent.findUnique({ where: { id: eventId }, select: {
    id: true, inquiryId: true, correlationId: true, type: true, evidence: true, recordedAt: true,
    inquiry: { select: { profile: { select: { id: true, userId: true } } } },
  } });
}

async function causeFor(database: Prisma.TransactionClient | PrismaClient, eventId: string): Promise<InquiryNotificationCause | undefined> {
  const event = await readEvent(database, eventId);
  if (!event) return undefined;
  const evidence = object(event.evidence);
  const assignmentId = text(evidence?.assignmentId);
  const assignment = assignmentId ? await database.partnerInquiryAssignment.findUnique({ where: { id: assignmentId },
    select: { id: true, inquiryId: true, responderId: true } }) : null;
  if (assignment && assignment.inquiryId !== event.inquiryId) return undefined;
  const partner = { audience: 'PARTNER' as const, recipientEvidenceId: event.inquiry.profile.id,
    projectionEvidenceId: event.id };
  const responder = assignment ? { audience: 'RESPONDER' as const, recipientEvidenceId: assignment.id,
    projectionEvidenceId: event.id } : undefined;
  const common = { eventId: event.id, correlationId: event.correlationId,
    occurredAt: event.recordedAt.toISOString() };
  if (event.type === 'INQUIRY_SUBMITTED' && responder) return { ...common, type: 'SUBMITTED', recipients: [responder] };
  if (event.type === 'INQUIRY_CANCELLED' && responder) return { ...common, type: 'CANCELLED', recipients: [responder] };
  if (event.type === 'INQUIRY_REASSIGNED' && responder) return { ...common, type: 'REASSIGNED', recipients: [partner, responder] };
  if (event.type === 'INQUIRY_DECIDED' || event.type === 'INQUIRY_PARTIALLY_DECIDED') {
    const batch = PartnerContracts.InquiryBatchResultSchema.safeParse(evidence?.batch);
    return batch.success ? { ...common, type: 'PARTIAL_RESPONSE', recipients: [partner], batch: batch.data } : undefined;
  }
  return undefined;
}

async function planned(database: Prisma.TransactionClient | PrismaClient, contract: ContractRuntime, eventId: string) {
  const cause = await causeFor(database, eventId);
  if (!cause) return [];
  const [clock] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return planInquiryNotifications(contract, { now: async () => clock.now.toISOString() }, cause);
}

async function inTransaction<T>(database: PrismaClient | Prisma.TransactionClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const client = database as PrismaClient;
  return typeof client.$transaction === 'function' ? client.$transaction(run) : run(database as Prisma.TransactionClient);
}

/** Rebuilds a safe notification from its immutable inquiry event and then
 * reauthorizes the current owner/assignment. Persisted notices never convey a grant. */
export function createInquiryNotificationAccess(contract: ContractRuntime): PartnerNotificationAccess {
  const verify = async (tx: Prisma.TransactionClient, notification: SafeNotification): Promise<PartnerNotificationEvidence | null> => {
    await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id =
      (SELECT "inquiryId" FROM partner_inquiry_events WHERE id = ${notification.projectionEvidenceId}) FOR UPDATE`;
    const cause = await causeFor(tx, notification.projectionEvidenceId);
    if (!cause) return null;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const notices = await planInquiryNotifications(contract, { now: async () => clock.now.toISOString() }, cause);
    const expected = notices.find(item => item.notificationId === notification.notificationId);
    if (!expected || contract.canonicalJson(expected) !== contract.canonicalJson(notification)) return null;
    const recipient = cause.recipients.find(item => item.recipientEvidenceId === notification.recipientEvidenceId);
    if (!recipient) return null;
    const event = await readEvent(tx, cause.eventId);
    if (!event) return null;
    const recipientUserId = recipient.audience === 'PARTNER' ? event.inquiry.profile.userId
      : (await tx.partnerInquiryAssignment.findUnique({ where: { id: recipient.recipientEvidenceId },
        select: { responderId: true } }))?.responderId;
    if (!recipientUserId) return null;
    const authorization = createPrismaPartnerAuthorizationV2(tx, { actorId: recipientUserId,
      purpose: recipient.audience, channel: 'API' }, resolvePartnerScopedAuthority);
    const result = await authorization.authorize('INQUIRY_READ', { kind: 'INQUIRY', id: event.inquiryId });
    return result.ok ? { notification: expected, type: cause.type, recipientUserId } : null;
  };
  const notificationFor = async (tx: Prisma.TransactionClient, notificationId: string) => {
    const row = await tx.notification.findUnique({ where: { id: notificationId },
      select: { event: { select: { payload: true } } } });
    const parsed = contract.SafeNotificationSchema.safeParse(row?.event?.payload);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    lockAndAuthorize: verify,
    canRead: (database, input) => inTransaction(database, async tx => {
      const notification = await notificationFor(tx, input.notificationId);
      return notification ? (await verify(tx, notification))?.recipientUserId === input.userId : false;
    }),
    resolveAction: (database, input) => inTransaction(database, async tx => {
      const notification = await notificationFor(tx, input.notificationId);
      return notification && (await verify(tx, notification))?.recipientUserId === input.userId
        ? '/dashboard/sales/partner-inquiries' : null;
    }),
  };
}

export const inquiryNotificationAccess = createInquiryNotificationAccess(PartnerContracts);

async function recordAttempt(database: PrismaClient | Prisma.TransactionClient,
  eventId: string, handled: boolean, status?: string) {
  const [clock] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  await database.partnerInquiryNotificationDelivery.upsert({ where: { eventId },
    create: { eventId, attempts: 1, lastAttemptAt: clock.now,
      ...(handled ? { handledAt: clock.now, status } : {}) },
    update: { attempts: { increment: 1 }, lastAttemptAt: clock.now,
      ...(handled ? { handledAt: clock.now, status } : {}) },
  });
}

/** Delivers committed source events idempotently. A separate delivery ledger
 * records every attempt while the immutable source event stays append-only. */
export async function dispatchPartnerInquiryEvents(database: PrismaClient, eventIds: readonly string[],
  access: PartnerNotificationAccess = inquiryNotificationAccess): Promise<void> {
  for (const eventId of [...new Set(eventIds)]) {
    await database.$transaction(async tx => {
      const key = `partner-inquiry-delivery-v1:${eventId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const completed = await tx.partnerInquiryNotificationDelivery.findUnique({
        where: { eventId }, select: { handledAt: true },
      });
      if (completed?.handledAt) return;
      try {
        const notices = await planned(tx, PartnerContracts, eventId);
        if (!notices.length) { await recordAttempt(tx, eventId, false); return; }
        const gateway = createPartnerInAppGateway(PartnerContracts, tx, access);
        const results: Awaited<ReturnType<NotificationGateway['enqueue']>>[] = [];
        for (const notice of notices) results.push(await gateway.enqueue(notice));
        const delivered = results.every(result => result.ok);
        const handled = results.every(result => result.ok || result.error.code === 'NOT_FOUND');
        const status = delivered ? 'DELIVERED' : handled && results.some(result => result.ok) ? 'DELIVERED_WITH_SKIPS' : 'SKIPPED';
        await recordAttempt(tx, eventId, handled, handled ? status : undefined);
      } catch {
        // The source event remains pending. Never persist validator, database or
        // recipient details in the retry ledger.
        await recordAttempt(tx, eventId, false);
      }
    });
  }
}

export async function deliverPendingPartnerInquiryEvents(database: PrismaClient): Promise<number> {
  const pending = await database.partnerInquiryEvent.findMany({ where: { OR: [
    { notificationDelivery: null }, { notificationDelivery: { handledAt: null } },
  ] },
    orderBy: { recordedAt: 'asc' }, take: 25, select: { id: true } });
  if (pending.length) await dispatchPartnerInquiryEvents(database, pending.map(item => item.id));
  return pending.length;
}

export function startPartnerInquiryNotificationDelivery(database: PrismaClient) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await deliverPendingPartnerInquiryEvents(database); }
    catch (error) { console.error('Partner inquiry notification delivery failed:', error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 1_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
