import { startBackgroundJob } from '../../backgroundJobLifecycle';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as PartnerContracts from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerAuthorizationV2 } from '../authorization/prisma';
import { readResponderScopedAuthority, resolvePartnerScopedAuthority } from '../authorization/centralAuthority';
import { createPartnerAuthorizationV2 } from '../authorization/service';
import type { AuthorizationEvidence } from '../authorization/contracts';
import { measureNotificationRead, withNotificationReadSlot } from '../../notificationReadObservation';
import { createPartnerInAppGateway } from './gateway';
import { planInquiryNotifications, type InquiryNotificationCause } from './inquiries';
import type { ContractRuntime, NotificationGateway, SafeNotification } from './contracts';
import { PARTNER_NOTIFICATION_RESOURCE, type PartnerNotificationAccess, type PartnerNotificationEvidence } from './access';

type Evidence = Record<string, unknown>;

function object(value: unknown): Evidence | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Evidence : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const eventSelect = {
  id: true, inquiryId: true, correlationId: true, type: true, evidence: true, recordedAt: true,
  inquiry: { select: { profile: { select: { id: true, userId: true } } } },
} satisfies Prisma.PartnerInquiryEventSelect;
type InquiryEvent = Prisma.PartnerInquiryEventGetPayload<{ select: typeof eventSelect }>;
const assignmentSelect = { id: true, inquiryId: true, responderId: true } as const;
type InquiryAssignment = Prisma.PartnerInquiryAssignmentGetPayload<{ select: typeof assignmentSelect }>;

const assignmentIdFor = (event: InquiryEvent) => text(object(event.evidence)?.assignmentId);

function causeFromEvidence(event: InquiryEvent, assignment?: InquiryAssignment | null): InquiryNotificationCause | undefined {
  const evidence = object(event.evidence);
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

async function readCause(database: Prisma.TransactionClient | PrismaClient, eventId: string) {
  const event = await database.partnerInquiryEvent.findUnique({ where: { id: eventId }, select: eventSelect });
  if (!event) return;
  const assignmentId = assignmentIdFor(event);
  const assignment = assignmentId ? await database.partnerInquiryAssignment.findUnique({
    where: { id: assignmentId }, select: assignmentSelect,
  }) : null;
  const cause = causeFromEvidence(event, assignment);
  if (cause) return { event, assignment, cause };
}

function verifyNotice(contract: ContractRuntime, notification: SafeNotification, evidence: {
  event: InquiryEvent;
  assignment?: InquiryAssignment | null;
  cause: InquiryNotificationCause;
  projected: SafeNotification[];
}) {
  const expected = evidence.projected.find(item => item.notificationId === notification.notificationId);
  if (!expected || contract.canonicalJson(expected) !== contract.canonicalJson(notification)) return null;
  const recipient = evidence.cause.recipients.find(item => item.recipientEvidenceId === notification.recipientEvidenceId);
  if (!recipient) return null;
  const recipientUserId = recipient.audience === 'PARTNER'
    ? evidence.event.inquiry.profile.userId : evidence.assignment?.responderId;
  return recipientUserId ? { expected, recipientUserId, audience: recipient.audience } : null;
}

async function planned(database: Prisma.TransactionClient | PrismaClient, contract: ContractRuntime, eventId: string) {
  const evidence = await readCause(database, eventId);
  if (!evidence) return [];
  const [clock] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return planInquiryNotifications(contract, { now: async () => clock.now.toISOString() }, evidence.cause);
}

async function inTransaction<T>(database: PrismaClient | Prisma.TransactionClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>, isolationLevel?: Prisma.TransactionIsolationLevel): Promise<T> {
  const client = database as PrismaClient;
  return typeof client.$transaction === 'function'
    ? client.$transaction(run, { isolationLevel })
    : run(database as Prisma.TransactionClient);
}

async function readableInquiryNoticeIds(tx: Prisma.TransactionClient, contract: ContractRuntime, userId: string, ids: string[]) {
  const rows = await measureNotificationRead('partnerInquiry', 'evidence', () => tx.notification.findMany({
    where: { id: { in: ids }, userId, user: { isActive: true }, event: { resourceType: PARTNER_NOTIFICATION_RESOURCE } },
    select: { id: true, event: { select: { payload: true } } },
  }));
  const notices = rows.flatMap(row => {
    const parsed = contract.SafeNotificationSchema.safeParse(row.event?.payload);
    return parsed.success ? [{ id: row.id, notice: parsed.data }] : [];
  });
  const allowed = new Set<string>();
  if (!notices.length) return allowed;
  const eventIds = [...new Set(notices.map(row => row.notice.projectionEvidenceId))];
  const events = await measureNotificationRead('partnerInquiry', 'evidence', () =>
    tx.partnerInquiryEvent.findMany({ where: { id: { in: eventIds } }, select: eventSelect }));
  const assignmentIds = [...new Set(events.flatMap(event => assignmentIdFor(event) ?? []))];
  const assignments = assignmentIds.length ? await measureNotificationRead('partnerInquiry', 'evidence', () =>
    tx.partnerInquiryAssignment.findMany({ where: { id: { in: assignmentIds } }, select: assignmentSelect })) : [];
  const assignmentById = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const [clock] = await measureNotificationRead('partnerInquiry', 'evidence', () => tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS now`);
  const evaluatedAt = clock.now.toISOString();
  const evidenceByEventId = new Map<string, {
    event: InquiryEvent;
    assignment: InquiryAssignment | undefined;
    cause: InquiryNotificationCause;
    projected: SafeNotification[];
  }>();
  for (const event of events) {
    const assignment = assignmentById.get(assignmentIdFor(event) ?? '');
    const cause = causeFromEvidence(event, assignment);
    if (!cause) continue;
    const projected = await planInquiryNotifications(contract, { now: async () => evaluatedAt }, cause);
    evidenceByEventId.set(event.id, { event, assignment, cause, projected });
  }
  const verified = notices.flatMap(({ id, notice }) => {
    const evidence = evidenceByEventId.get(notice.projectionEvidenceId);
    if (!evidence) return [];
    const verified = verifyNotice(contract, notice, evidence);
    if (!verified || verified.recipientUserId !== userId) return [];
    return [{ id, inquiryId: evidence.event.inquiryId, audience: verified.audience }];
  });
  if (!verified.length) return allowed;

  // The inbox only presents visibility. One consistent MVCC snapshot can read
  // current grants and assignments without entering the command lock graph.
  const inquiryIds = [...new Set(verified.map(row => row.inquiryId))];
  const inquiries = await measureNotificationRead('partnerInquiry', 'authority', () => tx.partnerInquiry.findMany({
    where: { id: { in: inquiryIds } },
    select: { id: true, profile: { select: { userId: true, state: true, revision: true, user: { select: { departmentId: true } } } },
      assignments: { orderBy: { revision: 'desc' }, take: 1, select: { id: true, revision: true, responderId: true } } },
  }));
  const actor = await measureNotificationRead('partnerInquiry', 'authority', () => tx.user.findUnique({
    where: { id: userId }, select: { id: true, isActive: true, role: true, departmentId: true,
      partnerProfile: { select: { state: true, revision: true } } },
  }));
  if (!actor?.isActive) return allowed;
  const authority = await measureNotificationRead('partnerInquiry', 'authority', () =>
    readResponderScopedAuthority(tx, { actorId: userId, root: { kind: 'INQUIRY', id: inquiryIds[0] } }));
  const disabled = await measureNotificationRead('partnerInquiry', 'authority', () => tx.featurePermission.findMany({
    where: { userId, isActive: true, permissionLevel: 'none', OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] },
    select: { feature: true },
  }));
  const resources = new Map(inquiries.map(inquiry => [inquiry.id, inquiry]));
  const decisions = new Map<string, boolean>();
  for (const row of verified) {
    const key = `${row.audience}:${row.inquiryId}`;
    let visible = decisions.get(key);
    if (visible === undefined) {
      const inquiry = resources.get(row.inquiryId);
      if (!inquiry) continue;
      const { profile, assignments: [assignment] } = inquiry;
      const root = { kind: 'INQUIRY', id: row.inquiryId } as const;
      const evidence: AuthorizationEvidence<PartnerContracts.PartnerActionV2> = {
        ...authority, evaluatedAt, actor: {
          id: userId, active: actor.isActive, role: actor.role, departmentId: actor.departmentId ?? undefined,
          partnerProfile: actor.partnerProfile ?? undefined, disabledFeatures: disabled.map(item => item.feature),
        },
        resource: {
          root, partnerSellerId: profile.userId, partnerStatus: profile.state, lifecycleRevision: profile.revision,
          departmentId: profile.user.departmentId ?? undefined,
          assignment: assignment ? { actorId: assignment.responderId, assignmentId: assignment.id,
            revision: assignment.revision, eligible: assignment.responderId === userId && !actor.partnerProfile } : undefined,
        },
      };
      visible = (await createPartnerAuthorizationV2({ read: async () => evidence },
        { actorId: userId, purpose: row.audience, channel: 'API' }).authorize('INQUIRY_READ', root)).ok;
      decisions.set(key, visible);
    }
    if (visible) allowed.add(row.id);
  }
  return allowed;
}

/** Rebuilds a safe notification from its immutable inquiry event and then
 * reauthorizes the current owner/assignment. Persisted notices never convey a grant. */
export function createInquiryNotificationAccess(contract: ContractRuntime): PartnerNotificationAccess {
  const verify = async (tx: Prisma.TransactionClient, notification: SafeNotification): Promise<PartnerNotificationEvidence | null> => {
    // Cause and assignment evidence are immutable. The authorization step
    // takes the Profile and Inquiry locks before reading current authority.
    const evidence = await readCause(tx, notification.projectionEvidenceId);
    if (!evidence) return null;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const projected = await planInquiryNotifications(contract, { now: async () => clock.now.toISOString() }, evidence.cause);
    const verified = verifyNotice(contract, notification, { ...evidence, projected });
    if (!verified) return null;
    const { expected, recipientUserId, audience } = verified;
    const authorization = createPrismaPartnerAuthorizationV2(tx, { actorId: recipientUserId,
      purpose: audience, channel: 'API' }, resolvePartnerScopedAuthority);
    const result = await authorization.authorize('INQUIRY_READ', { kind: 'INQUIRY', id: evidence.event.inquiryId });
    return result.ok ? { notification: expected, type: evidence.cause.type, recipientUserId } : null;
  };
  const notificationFor = async (tx: Prisma.TransactionClient, notificationId: string) => {
    const row = await tx.notification.findUnique({ where: { id: notificationId },
      select: { event: { select: { payload: true } } } });
    const parsed = contract.SafeNotificationSchema.safeParse(row?.event?.payload);
    return parsed.success ? parsed.data : undefined;
  };
  return {
    lockAndAuthorize: verify,
    async readableIds(database, { userId, notificationIds }) {
      const allowed = new Set<string>();
      for (let start = 0; start < notificationIds.length; start += 100) {
        const ids = notificationIds.slice(start, start + 100);
        const readable = await withNotificationReadSlot('partnerInquiry', () =>
          measureNotificationRead('partnerInquiry', 'transaction', () =>
            inTransaction(database, tx => readableInquiryNoticeIds(tx, contract, userId, ids), Prisma.TransactionIsolationLevel.RepeatableRead)));
        for (const id of readable) allowed.add(id);
      }
      return allowed;
    },
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
  return startBackgroundJob({ name: 'startPartnerInquiryNotificationDelivery', intervalMs: 1_000, run });
}
