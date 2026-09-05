import type { Prisma, PrismaClient } from '@prisma/client';
import type { SafeNotification, InquiryNoticeType } from './contracts';

export const PARTNER_NOTIFICATION_RESOURCE = 'PARTNER_NOTIFICATION';
export type NotificationDatabase = PrismaClient | Prisma.TransactionClient;
export type PartnerNotificationEvidence = {
  notification: SafeNotification;
  type: InquiryNoticeType;
  recipientUserId: string;
};

/** #319/#318 load immutable evidence and reauthorize CURRENT profile, grant,
 * assignment and ownership. No role fallback. lockAndAuthorize serializes with
 * authority changes in the supplied transaction and verifies request binding. */
export interface PartnerNotificationAccess {
  lockAndAuthorize(database: Prisma.TransactionClient, notification: SafeNotification): Promise<PartnerNotificationEvidence | null>;
  canRead(database: NotificationDatabase, input: { userId: string; notificationId: string }): Promise<boolean>;
  resolveAction(database: NotificationDatabase, input: { userId: string; notificationId: string }): Promise<string | null>;
}

let currentAccess: PartnerNotificationAccess | undefined;

/** Composition-only, before server startup; never installed by a request. */
export function registerPartnerNotificationAccess(access: PartnerNotificationAccess): void {
  if (currentAccess && currentAccess !== access) throw new Error('PARTNER_NOTIFICATION_ACCESS_ALREADY_REGISTERED');
  currentAccess = access;
}

export async function canReadPartnerNotification(
  database: NotificationDatabase, userId: string, notificationId: string,
  access = currentAccess,
): Promise<boolean> {
  if (!access) return false;
  try {
    const row = await database.notification.findFirst({
      where: { id: notificationId, userId, user: { isActive: true }, event: { resourceType: PARTNER_NOTIFICATION_RESOURCE } },
      select: { id: true },
    });
    return !!row && await access.canRead(database, { userId, notificationId });
  } catch { return false; }
}

/** #334 wires the existing action route here. The destination also reauthorizes
 * the action; this never conveys a grant or relies on an old assignment. */
export async function resolvePartnerNotificationAction(
  database: NotificationDatabase, userId: string, notificationId: string,
  access = currentAccess,
): Promise<string | null> {
  if (!access || !await canReadPartnerNotification(database, userId, notificationId, access)) return null;
  try {
    const url = await access.resolveAction(database, { userId, notificationId });
    return url?.startsWith('/dashboard/') && !/[\\\r\n]/.test(url) ? url : null;
  } catch { return null; }
}
