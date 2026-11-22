import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/** The intent is committed BEFORE provider contact. UNKNOWN is deliberately
 * terminal for automatic delivery: neither lease expiry nor a new worker can
 * establish whether a disconnected provider accepted the preceding request.
 * No endpoint, credential or business message is stored in this journal. */
export async function deliverNotificationToDevice(input: {
  database: PrismaClient;
  notificationIds: string[];
  subscriptionId: string;
  payload: string;
  authorize: () => Promise<boolean>;
  send: () => Promise<unknown>;
}): Promise<'DELIVERED' | 'UNKNOWN' | 'SUPPRESSED' | 'ALREADY_RECORDED' | 'EXPIRED'> {
  const ids = [...new Set(input.notificationIds)].sort();
  if (!ids.length || ids.some(id => !id) || !input.subscriptionId) throw new Error('INVALID_NOTIFICATION_DEVICE_INTENT');
  const channel = `WEB_PUSH_DEVICE_V1:${createHash('sha256').update(input.subscriptionId).digest('hex')}`;
  const token = randomUUID();
  const intent = JSON.stringify({ format: 'notification-device-intent/v1', token,
    payloadSha256: createHash('sha256').update(input.payload).digest('hex') });
  if (!await input.authorize()) return 'SUPPRESSED';
  const claimed = await input.database.$transaction(async transaction => {
    // All new immediate/digest workers serialize on this device. Old workers
    // must be drained before adoption; this cannot fence non-cooperating code.
    await transaction.$executeRaw`SET LOCAL lock_timeout = '2s'`;
    await transaction.$executeRaw`SET LOCAL synchronous_commit = on`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${channel}, 0))`;
    const recorded = await transaction.notificationDeliveryAttempt.findMany({
      where: { notificationId: { in: ids }, OR: [{ channel }, { channel: 'WEB_PUSH', status: 'DELIVERED' }] },
      select: { notificationId: true, status: true },
    });
    const blocked = new Set(recorded.map(row => row.notificationId));
    const pending = ids.filter(id => !blocked.has(id));
    const unresolved = recorded.some(row => row.status === 'UNKNOWN');
    // UNKNOWN is already durable if the process disappears before, during or
    // after contact. A provider success never depends on lastUsedAt writes.
    const rows = await Promise.all(pending.map(notificationId => transaction.notificationDeliveryAttempt.create({
      data: { notificationId, channel, status: 'UNKNOWN', error: intent }, select: { id: true },
    })));
    return { rows, unresolved };
  }, { maxWait: 2_000, timeout: 5_000 });
  if (!claimed.rows.length) return claimed.unresolved ? 'UNKNOWN' : 'ALREADY_RECORDED';
  const finish = async (status: string) => {
    const result = await input.database.notificationDeliveryAttempt.updateMany({
      where: { id: { in: claimed.rows.map(row => row.id) }, channel, status: 'UNKNOWN', error: intent },
      data: { status },
    });
    if (result.count !== claimed.rows.length) throw new Error('NOTIFICATION_DEVICE_INTENT_CHANGED');
  };
  // Refresh authorization after the transaction wait, immediately before contact.
  if (!await input.authorize()) { await finish('SUPPRESSED'); return 'SUPPRESSED'; }
  try {
    await input.send();
  } catch (error) {
    if ([404, 410].includes(Number((error as { statusCode?: unknown })?.statusCode))) {
      await finish('EXPIRED');
      return 'EXPIRED';
    }
    // Transport errors, timeouts and even most HTTP errors cannot prove that
    // no effect occurred. Retain the intent for explicit reconciliation.
    return 'UNKNOWN';
  }
  await finish('DELIVERED');
  return claimed.unresolved ? 'UNKNOWN' : 'DELIVERED';
}
