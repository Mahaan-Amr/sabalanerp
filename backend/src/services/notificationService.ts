import type { Notification, Prisma, PrismaClient } from '@prisma/client';
import webPush from 'web-push';
import {
  materializeNotificationEvent,
  notificationEventDefinition,
  privacySafeWebPushPayload,
  type NotificationChannel,
  type NotificationPolicyDraft,
  type NotificationRecipientResolver,
  type RegisteredNotificationEventType,
} from './notificationPolicy';
import { filterCurrentlyAuthorizedNotifications } from './notificationAuthorization';
import { isPartnerInquiryNotification } from './partnerSales/notifications/definitions';

type NotificationDatabase = PrismaClient | Prisma.TransactionClient;

const webPushConfigured = Boolean(
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY
  && process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
);
if (webPushConfigured) {
  webPush.setVapidDetails(
    process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:support@sabalanerp.local',
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY!,
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY!,
  );
}

export interface PublishNotificationEventInput {
  type: RegisteredNotificationEventType;
  deduplicationKey: string;
  recipientIds: string[];
  recipientGroups?: Partial<Record<NotificationRecipientResolver, string[]>>;
  actorId?: string | null;
  workspace?: string | null;
  feature?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  referenceId?: string | null;
  actionUrl?: string | null;
  payload?: Record<string, unknown>;
}

const jsonStringArray = (value: Prisma.JsonValue, fallback: string[]): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : fallback;

const deliveryChannels = (notification: { type: string; policyVersion: { channels: Prisma.JsonValue } | null }): string[] =>
  isPartnerInquiryNotification(notification.type) ? ['IN_APP']
    : notification.policyVersion ? jsonStringArray(notification.policyVersion.channels, ['IN_APP', 'REALTIME'])
      : ['IN_APP', 'REALTIME'];

const latestPolicy = async (
  database: NotificationDatabase,
  type: RegisteredNotificationEventType,
) => {
  const definition = notificationEventDefinition(type);
  const existing = await database.notificationPolicyVersion.findFirst({
    where: { eventType: type },
    orderBy: { version: 'desc' },
  });
  if (existing) return existing;

  return database.notificationPolicyVersion.upsert({
    where: {
      eventType_version: { eventType: type, version: 1 },
    },
    update: {},
    create: {
      eventType: type,
      version: 1,
      enabled: true,
      mandatory: definition.mandatory,
      titleTemplate: definition.titleTemplate,
      messageTemplate: definition.messageTemplate,
      priority: definition.priority,
      channels: [...definition.allowedChannels],
      recipientResolvers: [...definition.allowedRecipientResolvers],
      batching: 'IMMEDIATE',
      changeReason: 'سیاست پیش‌فرض ثبت‌شده در سامانه',
    },
  });
};

export const publishNotificationEvent = async (
  database: NotificationDatabase,
  input: PublishNotificationEventInput,
) => {
  const definition = notificationEventDefinition(input.type);
  const policy = await latestPolicy(database, input.type);
  if (!policy.enabled && !definition.mandatory) return null;

  const policyDraft: NotificationPolicyDraft = {
    enabled: definition.mandatory ? true : policy.enabled,
    titleTemplate: policy.titleTemplate,
    messageTemplate: policy.messageTemplate,
    priority: policy.priority as NotificationPolicyDraft['priority'],
    channels: jsonStringArray(policy.channels, ['IN_APP', 'REALTIME']) as NotificationChannel[],
    recipientResolvers: jsonStringArray(
      policy.recipientResolvers,
      [...definition.allowedRecipientResolvers],
    ) as NotificationPolicyDraft['recipientResolvers'],
  };
  if (isPartnerInquiryNotification(input.type)) {
    // Partner inquiry notifications have fixed, non-economic text and are
    // in-app only even if an older/custom stored policy asks for wider delivery.
    policyDraft.titleTemplate = definition.titleTemplate;
    policyDraft.messageTemplate = definition.messageTemplate;
    policyDraft.channels = ['IN_APP'];
    policyDraft.recipientResolvers = ['DIRECT_USER'];
  }
  const selectedPolicyRecipientIds = input.recipientGroups
    ? policyDraft.recipientResolvers.flatMap((resolver) => input.recipientGroups?.[resolver] || [])
    : input.recipientIds;
  const mandatoryAdminRecipients = definition.mandatory
    && definition.allowedRecipientResolvers.includes('ACTIVE_ADMINS')
    ? input.recipientGroups?.ACTIVE_ADMINS || []
    : [];
  const mandatoryDirectRecipients = definition.mandatory
    && definition.allowedRecipientResolvers.includes('DIRECT_USER')
    ? input.recipientGroups?.DIRECT_USER || []
    : [];
  const policyRecipientIds = [...new Set([
    ...selectedPolicyRecipientIds,
    ...mandatoryAdminRecipients,
    ...mandatoryDirectRecipients,
  ])];
  const materialized = materializeNotificationEvent({
    definition,
    actorId: input.actorId,
    recipientIds: policyRecipientIds,
    payload: input.payload || {},
    actionUrl: input.actionUrl,
    policy: policyDraft,
  });
  if (!materialized.recipientIds.length) return null;

  const event = await database.notificationEvent.upsert({
    where: { deduplicationKey: input.deduplicationKey },
    update: {},
    create: {
      type: input.type,
      actorId: input.actorId || null,
      workspace: input.workspace || null,
      feature: input.feature || null,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      payload: (input.payload || {}) as Prisma.InputJsonValue,
      deduplicationKey: input.deduplicationKey,
    },
  });

  await database.notification.createMany({
    data: materialized.recipientIds.map((userId) => ({
      eventId: event.id,
      userId,
      policyVersionId: policy.id,
      type: input.type,
      title: materialized.title,
      message: materialized.message,
      priority: materialized.priority,
      actionUrl: materialized.actionUrl,
      referenceId: input.referenceId === null ? null : input.referenceId || input.resourceId || null,
    })),
    skipDuplicates: true,
  });
  await database.notificationOutbox.upsert({
    where: { eventId: event.id },
    update: {},
    create: { eventId: event.id },
  });
  return event;
};

export type RealtimeNotificationPublisher = (userId: string, notification: Notification) => Promise<void> | void;

export const deliverPendingNotificationOutbox = async (
  prisma: PrismaClient,
  publishRealtime: RealtimeNotificationPublisher,
  now = new Date(),
): Promise<{ delivered: number; failed: number }> => {
  await prisma.notificationOutbox.updateMany({
    where: {
      status: 'PROCESSING',
      claimedAt: { lt: new Date(now.getTime() - 5 * 60 * 1_000) },
    },
    data: {
      status: 'PENDING',
      claimedAt: null,
      availableAt: now,
      lastError: 'Recovered an expired delivery lease',
    },
  });
  const candidate = await prisma.notificationOutbox.findFirst({
    where: { status: 'PENDING', availableAt: { lte: now } },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return { delivered: 0, failed: 0 };

  const claimed = await prisma.notificationOutbox.updateMany({
    where: { id: candidate.id, status: 'PENDING', availableAt: { lte: now } },
    data: { status: 'PROCESSING', claimedAt: now, attempts: { increment: 1 } },
  });
  if (!claimed.count) return { delivered: 0, failed: 0 };

  const notifications = await prisma.notification.findMany({
    where: { eventId: candidate.eventId },
    orderBy: { createdAt: 'asc' },
    include: {
      policyVersion: true,
      deliveryAttempts: true,
      event: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
  });
  let delivered = 0;
  let failed = 0;
  for (const notification of notifications) {
    const currentlyAuthorized = (
      await filterCurrentlyAuthorizedNotifications(prisma, notification.user, [notification])
    ).length > 0;
    const channels = deliveryChannels(notification);
    const realtimeDelivered = notification.deliveryAttempts.some(
      (attempt) => attempt.channel === 'REALTIME' && attempt.status === 'DELIVERED',
    );
    if (currentlyAuthorized && channels.includes('REALTIME') && !realtimeDelivered) {
      try {
        await publishRealtime(notification.userId, notification);
        await prisma.notificationDeliveryAttempt.create({
          data: { notificationId: notification.id, channel: 'REALTIME', status: 'DELIVERED' },
        });
        delivered += 1;
      } catch (error) {
        await prisma.notificationDeliveryAttempt.create({
          data: {
            notificationId: notification.id,
            channel: 'REALTIME',
            status: 'FAILED',
            error: error instanceof Error ? error.message : 'Realtime delivery failed',
          },
        });
        failed += 1;
      }
    }

    const pushDelivered = notification.deliveryAttempts.some(
      (attempt) => attempt.channel === 'WEB_PUSH' && attempt.status === 'DELIVERED',
    );
    if (currentlyAuthorized && webPushConfigured && channels.includes('WEB_PUSH') && !pushDelivered) {
      const definition = notificationEventDefinition(notification.type as RegisteredNotificationEventType);
      const [preference, subscriptions] = await Promise.all([
        prisma.notificationPreference.findUnique({ where: { userId: notification.userId } }),
        prisma.webPushSubscription.findMany({
          where: {
            userId: notification.userId,
            disabledAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),
      ]);
      const mutedCategories = preference
        ? jsonStringArray(preference.mutedCategories, [])
        : [];
      const optionalMuted = !definition.mandatory
        && (mutedCategories.includes(notification.type) || mutedCategories.includes(notification.type.split('_')[0]));
      const batched = notification.priority === 'LOW'
        && (
          preference?.lowPriorityDelivery === 'DAILY'
          || notification.policyVersion?.batching === 'DAILY'
        );
      if (preference?.webPushEnabled && !optionalMuted && !batched) {
        let pushFailed = false;
        for (const subscription of subscriptions) {
          try {
            await webPush.sendNotification(
              { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
              JSON.stringify(privacySafeWebPushPayload(notification.actionUrl)),
              { TTL: notification.priority === 'URGENT' ? 86_400 : 21_600, urgency: notification.priority === 'URGENT' ? 'high' : 'normal' },
            );
            await prisma.webPushSubscription.update({
              where: { id: subscription.id },
              data: { lastUsedAt: now },
            });
          } catch (error: any) {
            if ([404, 410].includes(Number(error?.statusCode))) {
              await prisma.webPushSubscription.delete({ where: { id: subscription.id } });
            } else {
              pushFailed = true;
            }
          }
        }
        if (subscriptions.length) {
          await prisma.notificationDeliveryAttempt.create({
            data: {
              notificationId: notification.id,
              channel: 'WEB_PUSH',
              status: pushFailed ? 'FAILED' : 'DELIVERED',
              error: pushFailed ? 'One or more device deliveries failed' : null,
            },
          });
          if (pushFailed) failed += 1;
          else delivered += 1;
        }
      }
    }
  }

  if (failed) {
    const delaySeconds = Math.min(300, 2 ** Math.min(candidate.attempts + 1, 8));
    await prisma.notificationOutbox.update({
      where: { id: candidate.id },
      data: {
        status: 'PENDING',
        availableAt: new Date(now.getTime() + delaySeconds * 1_000),
        claimedAt: null,
        lastError: `${failed} notification deliveries failed`,
      },
    });
  } else {
    await prisma.notificationOutbox.update({
      where: { id: candidate.id },
      data: { status: 'PROCESSED', processedAt: now, claimedAt: null, lastError: null },
    });
  }
  return { delivered, failed };
};

export const deliverDailyWebPushDigests = async (
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ users: number; notifications: number }> => {
  if (!webPushConfigured) return { users: 0, notifications: 0 };
  const preferences = await prisma.notificationPreference.findMany({
    where: { webPushEnabled: true },
    select: { userId: true, lowPriorityDelivery: true, mutedCategories: true },
  });
  if (!preferences.length) return { users: 0, notifications: 0 };

  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const candidates = await prisma.notification.findMany({
    where: {
      userId: { in: preferences.map((preference) => preference.userId) },
      priority: 'LOW',
      createdAt: { lte: cutoff },
      deliveryAttempts: { none: { channel: 'WEB_PUSH', status: 'DELIVERED' } },
    },
    include: {
      policyVersion: true,
      event: true,
      user: { select: { id: true, role: true, isActive: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  const preferenceByUser = new Map(preferences.map((preference) => [preference.userId, preference]));
  const grouped = new Map<string, typeof candidates>();
  for (const notification of candidates) {
    const currentlyAuthorized = (
      await filterCurrentlyAuthorizedNotifications(prisma, notification.user, [notification])
    ).length > 0;
    if (!currentlyAuthorized) continue;
    const preference = preferenceByUser.get(notification.userId);
    if (!preference) continue;
    const channels = deliveryChannels(notification);
    const definition = notificationEventDefinition(notification.type as RegisteredNotificationEventType);
    const muted = jsonStringArray(preference.mutedCategories, []);
    const optionalMuted = !definition.mandatory
      && (muted.includes(notification.type) || muted.includes(notification.type.split('_')[0]));
    const shouldBatch = preference.lowPriorityDelivery === 'DAILY'
      || notification.policyVersion?.batching === 'DAILY';
    if (!channels.includes('WEB_PUSH') || optionalMuted || !shouldBatch) continue;
    grouped.set(notification.userId, [...(grouped.get(notification.userId) || []), notification]);
  }

  let deliveredUsers = 0;
  let deliveredNotifications = 0;
  for (const [userId, notifications] of grouped) {
    const subscriptions = await prisma.webPushSubscription.findMany({
      where: { userId, disabledAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (!subscriptions.length) continue;
    let successfulDevices = 0;
    for (const subscription of subscriptions) {
      try {
        await webPush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(privacySafeWebPushPayload('/dashboard')),
          { TTL: 86_400, urgency: 'normal' },
        );
        successfulDevices += 1;
        await prisma.webPushSubscription.update({ where: { id: subscription.id }, data: { lastUsedAt: now } });
      } catch (error: any) {
        if ([404, 410].includes(Number(error?.statusCode))) {
          await prisma.webPushSubscription.delete({ where: { id: subscription.id } });
        }
      }
    }
    if (!successfulDevices) continue;
    await prisma.notificationDeliveryAttempt.createMany({
      data: notifications.map((notification) => ({
        notificationId: notification.id,
        channel: 'WEB_PUSH',
        status: 'DELIVERED',
      })),
    });
    deliveredUsers += 1;
    deliveredNotifications += notifications.length;
  }
  return { users: deliveredUsers, notifications: deliveredNotifications };
};

export const startNotificationOutboxDelivery = (
  prisma: PrismaClient,
  publishRealtime: RealtimeNotificationPublisher,
) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (let index = 0; index < 25; index += 1) {
        const result = await deliverPendingNotificationOutbox(prisma, publishRealtime);
        if (!result.delivered && !result.failed) break;
      }
    } catch (error) {
      console.error('Notification outbox delivery failed:', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 1_000);
  timer.unref?.();
  const runDigest = () => void deliverDailyWebPushDigests(prisma).catch((error) => {
    console.error('Daily Web Push digest delivery failed:', error);
  });
  void runDigest();
  const digestTimer = setInterval(runDigest, 60_000);
  digestTimer.unref?.();
  return () => {
    clearInterval(timer);
    clearInterval(digestTimer);
  };
};
