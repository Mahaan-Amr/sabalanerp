import { DispatchBuyerSmsStatus, PrismaClient } from '@prisma/client';
import smsService from './smsService';
import { PhysicalGateExitService } from './physicalGateExit';
import { getRecoveryRuntimeState } from './recoveryRuntime';

const POLL_INTERVAL_MS = 15_000;
const STALE_SENDING_MS = 5 * 60_000;

export const deliverPendingDispatchBuyerSms = async (prisma: PrismaClient, now = new Date()) => {
  const stale = await prisma.dispatchBuyerSmsIntent.findMany({ where: { status: DispatchBuyerSmsStatus.SENDING,
    lastAttemptAt: { lte: new Date(now.getTime() - STALE_SENDING_MS) } }, include: { physicalExit: { include: { authorization: true } } }, take: 50 });
  for (const intent of stale) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.dispatchBuyerSmsIntent.updateMany({ where: { id: intent.id, status: DispatchBuyerSmsStatus.SENDING }, data: {
        status: DispatchBuyerSmsStatus.UNKNOWN, unknownAt: now, lastError: 'Worker stopped after provider request; delivery outcome is unknown.',
      } });
      if (changed.count) await tx.dispatchConfirmationAlert.create({ data: { sessionId: intent.physicalExit.authorization.sessionId,
        alertType: 'BUYER_EXIT_SMS_UNKNOWN', payload: { physicalExitId: intent.physicalExitId, smsIntentId: intent.id,
          dispatchNumber: intent.dispatchNumber, status: 'UNKNOWN', detail: 'Recovered stale SENDING intent' } } });
    });
  }
  const ready = await prisma.dispatchBuyerSmsIntent.findMany({ where: { status: { in: [DispatchBuyerSmsStatus.PENDING, DispatchBuyerSmsStatus.RETRY] },
    availableAt: { lte: now }, phoneNumber: { not: null } }, orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }], take: 50 });
  const service = new PhysicalGateExitService(prisma, { now: () => now, sendBuyerSms: async (message) => {
    const result = await smsService.sendDispatchExitNotice(message);
    if (result.success) return { outcome: 'SENT', providerMessageId: String(result.messageId || `sandbox:${message.idempotencyKey}`) };
    const detail = result.error || 'SMS.ir rejected the dispatch exit notice.';
    const ambiguous = result.failureKind === 'NETWORK'
      && ['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(String(result.errorCode || '').toUpperCase());
    if (ambiguous || /timeout|socket hang up/i.test(detail)) return { outcome: 'UNKNOWN', detail };
    const retryable = result.failureKind === 'NETWORK'
      || (result.failureKind === 'HTTP' && (result.httpStatus === 429 || Number(result.httpStatus) >= 500));
    return retryable
      ? { outcome: 'FAILED', retryable: true, detail }
      : result.failureKind
        ? { outcome: 'FAILED', retryable: false, detail }
        : /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|temporar|rate limit|429|5\d\d|unavailable/i.test(detail)
          ? { outcome: 'FAILED', retryable: true, detail }
          : { outcome: 'FAILED', retryable: false, detail };
  } });
  const outcomes: Awaited<ReturnType<PhysicalGateExitService['deliverBuyerSms']>>[] = [];
  for (const intent of ready) {
    try { outcomes.push(await service.deliverBuyerSms(intent.id)); }
    catch (error) { console.error('Dispatch buyer SMS delivery failed:', error); }
  }
  return { recoveredUnknown: stale.length, attempted: ready.length, outcomes };
};

export const startDispatchBuyerSmsDelivery = (prisma: PrismaClient) => {
  const run = () => getRecoveryRuntimeState().mode === 'NORMAL'
    ? deliverPendingDispatchBuyerSms(prisma).catch((error) => console.error('Dispatch buyer SMS worker failed:', error))
    : Promise.resolve();
  void run();
  const timer = setInterval(() => void run(), POLL_INTERVAL_MS);
  timer.unref();
};
