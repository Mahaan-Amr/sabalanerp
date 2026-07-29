import express from 'express';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authorize, protect, type AuthRequest } from '../middleware/auth';
import { enforceMutationIdempotency } from '../middleware/idempotency';
import {
  filterCurrentlyAuthorizedNotifications,
  type NotificationWithAuthorizationEvent,
} from '../services/notificationAuthorization';
import {
  notificationEventDefinition,
  registeredNotificationEventDefinitions,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationRecipientResolver,
  validateNotificationPolicyDraft,
} from '../services/notificationPolicy';

const router = express.Router();
const prisma = new PrismaClient();
const priorities: NotificationPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const channels: NotificationChannel[] = ['IN_APP', 'REALTIME', 'WEB_PUSH'];
const recipientResolvers: NotificationRecipientResolver[] = [
  'DIRECT_USER',
  'ACTIVE_ADMINS',
  'SECURITY_INCIDENT_HANDLERS',
  'WORKSPACE_USERS',
  'HR_AUTHORITIES',
  'WORKSPACE_MANAGERS',
  'RESOURCE_OWNER',
  'EXPLICIT_WATCHERS',
];

router.use(protect);
router.use(enforceMutationIdempotency);

type NotificationListItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: string;
  actionUrl: string | null;
  referenceId: string | null;
  readAt: Date | null;
  createdAt: Date;
};
router.get('/', async (req: AuthRequest, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  let scanCursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const data: NotificationListItem[] = [];
  let nextCursor: string | null = null;
  let hasMore = false;

  // Authorization may remove records after the database page is read. Scan raw
  // pages until an authorized page is full so inaccessible rows cannot make
  // older, accessible notifications unreachable.
  while (data.length < limit) {
    const rows = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
      ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        priority: true,
        actionUrl: true,
        referenceId: true,
        readAt: true,
        createdAt: true,
        event: { select: { workspace: true, feature: true, resourceType: true, resourceId: true } },
      },
    });
    const candidates = rows.slice(0, 100);
    if (!candidates.length) break;
    const authorizedRows = await filterCurrentlyAuthorizedNotifications(
      prisma,
      req.user!,
      candidates as NotificationWithAuthorizationEvent[] & typeof candidates,
    );
    const authorizedIds = new Set(authorizedRows.map((row) => row.id));

    for (let index = 0; index < candidates.length; index += 1) {
      const row = candidates[index];
      if (!authorizedIds.has(row.id)) continue;
      const { event: _event, ...notification } = row;
      data.push(notification);
      if (data.length === limit) {
        const rawRowsRemain = index < candidates.length - 1 || rows.length > candidates.length;
        nextCursor = rawRowsRemain ? row.id : null;
        hasMore = rawRowsRemain;
        break;
      }
    }
    if (data.length === limit) break;
    if (rows.length <= candidates.length) break;
    scanCursor = candidates[candidates.length - 1].id;
  }

  res.json({
    success: true,
    data,
    pagination: { nextCursor, hasMore },
  });
});

router.get('/unread-count', async (req: AuthRequest, res) => {
  const rows = await prisma.notification.findMany({
    where: { userId: req.user!.id, readAt: null },
    select: {
      id: true,
      event: { select: { workspace: true, feature: true, resourceType: true, resourceId: true } },
    },
  });
  const authorizedRows = await filterCurrentlyAuthorizedNotifications(prisma, req.user!, rows);
  res.json({ success: true, data: { count: authorizedRows.length } });
});

router.put('/read-all', async (req: AuthRequest, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ success: true, data: { updated: result.count } });
});

router.put('/:id/read', async (req: AuthRequest, res) => {
  const result = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.id },
    data: { readAt: new Date() },
  });
  if (!result.count) return res.status(404).json({ success: false, error: 'اعلان پیدا نشد.' });
  res.json({ success: true });
});

router.get('/settings/preferences', async (req: AuthRequest, res) => {
  const [preference, devices] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { userId: req.user!.id } }),
    prisma.webPushSubscription.findMany({
      where: { userId: req.user!.id },
      select: { id: true, deviceLabel: true, userAgent: true, disabledAt: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({
    success: true,
    data: {
      preference: preference || {
        webPushEnabled: false,
        mutedCategories: [],
        lowPriorityDelivery: 'IMMEDIATE',
      },
      devices,
      webPushPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY || null,
      supported: Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY),
    },
  });
});

router.put(
  '/settings/preferences',
  [
    body('webPushEnabled').isBoolean(),
    body('mutedCategories').isArray(),
    body('mutedCategories.*').isString().isLength({ max: 80 }),
    body('lowPriorityDelivery').isIn(['IMMEDIATE', 'DAILY']),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'تنظیمات اعلان معتبر نیست.' });
    const mutedCategories = [...new Set(
      (req.body.mutedCategories as unknown[]).filter((value): value is string => typeof value === 'string'),
    )];
    const preference = await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: {
        userId: req.user!.id,
        webPushEnabled: req.body.webPushEnabled,
        mutedCategories,
        lowPriorityDelivery: req.body.lowPriorityDelivery,
      },
      update: {
        webPushEnabled: req.body.webPushEnabled,
        mutedCategories,
        lowPriorityDelivery: req.body.lowPriorityDelivery,
      },
    });
    res.json({ success: true, data: preference });
  },
);

router.post(
  '/settings/devices',
  [
    body('endpoint').isURL({ protocols: ['https'], require_protocol: true }),
    body('keys.p256dh').isString().isLength({ min: 20, max: 500 }),
    body('keys.auth').isString().isLength({ min: 10, max: 500 }),
    body('deviceLabel').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: 'اشتراک اعلان دستگاه معتبر نیست.' });
    if (!process.env.WEB_PUSH_VAPID_PUBLIC_KEY || !process.env.WEB_PUSH_VAPID_PRIVATE_KEY) {
      return res.status(503).json({ success: false, error: 'ارسال اعلان دستگاه روی این محیط پیکربندی نشده است.' });
    }
    const device = await prisma.webPushSubscription.upsert({
      where: { endpoint: req.body.endpoint },
      create: {
        userId: req.user!.id,
        endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh,
        auth: req.body.keys.auth,
        deviceLabel: req.body.deviceLabel || null,
        userAgent: req.headers['user-agent']?.slice(0, 500) || null,
      },
      update: {
        userId: req.user!.id,
        p256dh: req.body.keys.p256dh,
        auth: req.body.keys.auth,
        deviceLabel: req.body.deviceLabel || null,
        userAgent: req.headers['user-agent']?.slice(0, 500) || null,
        disabledAt: null,
      },
    });
    await prisma.notificationPreference.upsert({
      where: { userId: req.user!.id },
      create: { userId: req.user!.id, webPushEnabled: true, mutedCategories: [], lowPriorityDelivery: 'IMMEDIATE' },
      update: { webPushEnabled: true },
    });
    res.status(201).json({ success: true, data: { id: device.id, deviceLabel: device.deviceLabel, createdAt: device.createdAt } });
  },
);

router.delete('/settings/devices/:deviceId', async (req: AuthRequest, res) => {
  const result = await prisma.webPushSubscription.updateMany({
    where: { id: req.params.deviceId, userId: req.user!.id, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  if (!result.count) return res.status(404).json({ success: false, error: 'دستگاه پیدا نشد.' });
  res.json({ success: true });
});

router.delete('/settings/devices', async (req: AuthRequest, res) => {
  const result = await prisma.webPushSubscription.updateMany({
    where: { userId: req.user!.id, disabledAt: null },
    data: { disabledAt: new Date() },
  });
  await prisma.notificationPreference.upsert({
    where: { userId: req.user!.id },
    create: { userId: req.user!.id, webPushEnabled: false, mutedCategories: [], lowPriorityDelivery: 'IMMEDIATE' },
    update: { webPushEnabled: false },
  });
  res.json({ success: true, data: { disabled: result.count } });
});

router.get('/admin/policies', authorize('ADMIN'), async (_req, res) => {
  const stored = await prisma.notificationPolicyVersion.findMany({
    orderBy: [{ eventType: 'asc' }, { version: 'desc' }],
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, username: true } },
    },
  });
  const latestByType = new Map<string, typeof stored[number]>();
  for (const policy of stored) {
    if (!latestByType.has(policy.eventType)) latestByType.set(policy.eventType, policy);
  }
  const data = registeredNotificationEventDefinitions().map((definition) => ({
    definition,
    policy: latestByType.get(definition.type) || {
      eventType: definition.type,
      version: 0,
      enabled: true,
      mandatory: definition.mandatory,
      titleTemplate: definition.titleTemplate,
      messageTemplate: definition.messageTemplate,
      priority: definition.priority,
      channels: definition.allowedChannels,
      recipientResolvers: definition.allowedRecipientResolvers,
      batching: 'IMMEDIATE',
      changeReason: 'سیاست پیش‌فرض ثبت‌شده در کد',
      createdAt: null,
      createdBy: null,
    },
  }));
  res.json({ success: true, data });
});

router.post(
  '/admin/policies/:eventType/versions',
  authorize('ADMIN'),
  [
    body('enabled').isBoolean(),
    body('titleTemplate').isString().trim().isLength({ min: 1, max: 160 }),
    body('messageTemplate').isString().trim().isLength({ min: 1, max: 1_000 }),
    body('priority').isIn(priorities),
    body('channels').isArray({ min: 1 }),
    body('channels.*').isIn(channels),
    body('recipientResolvers').isArray({ min: 1 }),
    body('recipientResolvers.*').isIn(recipientResolvers),
    body('batching').isIn(['IMMEDIATE', 'DAILY']),
    body('changeReason').isString().trim().isLength({ min: 3, max: 500 }),
  ],
  async (req: AuthRequest, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: 'اطلاعات سیاست اعلان معتبر نیست.', details: errors.array() });
    }

    let definition;
    try {
      definition = notificationEventDefinition(req.params.eventType as never);
    } catch {
      return res.status(404).json({ success: false, error: 'رویداد اعلان ثبت‌شده نیست.' });
    }
    if (!definition) return res.status(404).json({ success: false, error: 'رویداد اعلان ثبت‌شده نیست.' });

    const draft = {
      enabled: Boolean(req.body.enabled),
      titleTemplate: String(req.body.titleTemplate),
      messageTemplate: String(req.body.messageTemplate),
      priority: req.body.priority as NotificationPriority,
      channels: req.body.channels as NotificationChannel[],
      recipientResolvers: req.body.recipientResolvers as NotificationRecipientResolver[],
    };
    const validated = validateNotificationPolicyDraft(definition, draft);
    if (!validated.valid) {
      return res.status(400).json({ success: false, error: validated.errors[0], details: validated.errors });
    }

    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.notificationPolicyVersion.findFirst({
        where: { eventType: definition.type },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.notificationPolicyVersion.create({
        data: {
          eventType: definition.type,
          version: (latest?.version || 0) + 1,
          enabled: definition.mandatory ? true : draft.enabled,
          mandatory: definition.mandatory,
          titleTemplate: draft.titleTemplate,
          messageTemplate: draft.messageTemplate,
          priority: draft.priority,
          channels: draft.channels,
          recipientResolvers: draft.recipientResolvers,
          batching: req.body.batching,
          createdById: req.user!.id,
          changeReason: String(req.body.changeReason).trim(),
        },
      });
    });
    res.status(201).json({ success: true, data: created });
  },
);

export default router;
