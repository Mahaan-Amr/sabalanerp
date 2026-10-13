import { Prisma, type PrismaClient } from '@prisma/client';
import smsService from './smsService';
import { getRecoveryRuntimeState, withRecoveryBackgroundWrite } from './recoveryRuntime';
import { cancellationNoticeRetryStatuses, cancellationSubmissionIsUnknown, normalizeCancellationMobile, resolveCancellationRecipient } from './contractCancellationNoticePolicy';

type Transaction = Prisma.TransactionClient;
const pendingStatuses = ['PENDING', 'RETRY', 'NEEDS_PHONE', 'NEEDS_SELECTION'];

// Writers already own their business locks. This helper never contacts a provider.
export async function enqueueContractCancellationNotice(tx: Transaction, input: {
  contractId: string; eventKey: string; at: Date;
}) {
  const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: input.contractId } });
  const ordinaryCycle = await tx.contractConfirmationAuditLog.findFirst({ where: {
    contractId: contract.id, eventType: 'CONTRACT_REACTIVATED',
  }, orderBy: { eventAt: 'desc' } });
  const partnerCycle = contract.partnerCaseId ? await tx.partnerCaseEvent.findFirst({ where: {
    caseId: contract.partnerCaseId, type: 'CASE_REACTIVATED',
  }, orderBy: { sequence: 'desc' } }) : null;
  const ordinaryEvidenceAt = (ordinaryCycle?.eventPayloadJson as Prisma.JsonObject | null)?.at;
  const ordinaryAt = typeof ordinaryEvidenceAt === 'string' && Number.isFinite(Date.parse(ordinaryEvidenceAt))
    ? new Date(ordinaryEvidenceAt) : ordinaryCycle?.eventAt;
  const cycleAt = partnerCycle?.recordedAt ?? ordinaryAt;
  const acceptance = await tx.contractPublicConfirmation.findFirst({ where: {
    contractId: contract.id, verifiedAt: cycleAt ? { gt: cycleAt } : { not: null }, lastSentAt: { not: null },
  }, orderBy: { verifiedAt: 'desc' } });
  // Legacy ordinary OTP evidence has its own table; verified=true alone also
  // means an invalidated unused code, so a real verifiedAt is mandatory.
  const legacyAcceptance = !acceptance && !contract.partnerCaseId && contract.commercialFlowVersion === 0
    ? await tx.contractVerificationCode.findFirst({ where: { contractId: contract.id,
      verified: true, verifiedAt: cycleAt ? { gt: cycleAt } : { not: null } } }) : null;
  if (!acceptance && !legacyAcceptance) return null;
  return tx.contractCancellationNotice.upsert({ where: { eventKey: input.eventKey }, update: {}, create: {
    eventKey: input.eventKey, contractId: contract.id, contractNumber: contract.contractNumber,
    sourceContractId: contract.id, customerId: contract.customerId,
    createdAt: input.at, availableAt: input.at,
  } });
}

export async function suppressContractCancellationNotices(tx: Transaction, contractId: string) {
  await tx.contractCancellationNotice.updateMany({ where: { contractId,
    status: { in: [...cancellationNoticeRetryStatuses, 'SENDING'] } },
  data: { status: 'SUPPRESSED', lastError: null } });
  await tx.contractCancellationNoticeAttempt.updateMany({ where: { status: 'SENDING', notice: { contractId } },
    data: { status: 'SUPPRESSED', completedAt: new Date() } });
}

async function lockNoticeOwner(tx: Transaction, contractId: string | null) {
  if (!contractId) return;
  const identity = await tx.salesContract.findUnique({ where: { id: contractId }, select: { partnerCaseId: true } });
  // Match Partner writer lock order: Case first, then its customer Contract.
  if (identity?.partnerCaseId) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "partner_sale_cases" WHERE "id" = ${identity.partnerCaseId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${contractId} FOR UPDATE`);
}

async function readRecipient(tx: Transaction, contractId: string | null, selected?: string | null, retainedCustomerId?: string) {
  const contract = contractId ? await tx.salesContract.findUnique({ where: { id: contractId }, include: {
    customer: { include: { phoneNumbers: true } },
  } }) : null;
  // A guarded administrative hard deletion must retain the cancellation
  // history and must not veto an already committed Customer notification.
  const customer = contract?.customer ?? (retainedCustomerId ? await tx.crmCustomer.findUnique({
    where: { id: retainedCustomerId }, include: { phoneNumbers: true },
  }) : null);
  const recipient = resolveCancellationRecipient(customer?.isActive && !customer.cardDeletedAt ? customer.phoneNumbers : [], selected);
  return { contract, recipient };
}

export async function readContractCancellationNotice(tx: Transaction, contractId: string) {
  const notice = await tx.contractCancellationNotice.findFirst({ where: { contractId }, orderBy: { createdAt: 'desc' },
    include: { attempts: { orderBy: { sequence: 'desc' }, take: 10 } } });
  if (!notice) return null;
  const { contract, recipient } = await readRecipient(tx, contractId, notice.selectedPhone);
  return { ...notice, availablePhoneNumbers: recipient.availablePhoneNumbers, defaultPhoneNumber: recipient.phoneNumber,
    canChoosePhone: recipient.canChoosePhone,
    canRetry: contract?.status === 'CANCELLED' && cancellationNoticeRetryStatuses.includes(notice.status) };
}

export async function retryContractCancellationNotice(tx: Transaction, input: {
  contractId: string; phoneNumber?: string; actorId: string;
}) {
  await lockNoticeOwner(tx, input.contractId);
  const notice = await tx.contractCancellationNotice.findFirst({ where: { contractId: input.contractId }, orderBy: { createdAt: 'desc' } });
  if (!notice || !cancellationNoticeRetryStatuses.includes(notice.status)) throw new Error('این اطلاع‌رسانی قابل ارسال مجدد نیست.');
  const { contract, recipient } = await readRecipient(tx, input.contractId, input.phoneNumber);
  if (contract?.status !== 'CANCELLED') throw new Error('قرارداد دیگر لغوشده نیست.');
  if (input.phoneNumber && !recipient.availablePhoneNumbers.includes(normalizeCancellationMobile(input.phoneNumber) || '')) {
    throw new Error('شماره انتخاب‌شده دیگر فعال نیست؛ شماره‌های مشتری را تازه‌سازی کنید.');
  }
  if (!recipient.phoneNumber) throw new Error(recipient.status === 'NEEDS_SELECTION'
    ? 'شماره گیرنده را انتخاب کنید.' : 'ابتدا موبایل فعال مشتری را ثبت کنید.');
  const updated = await tx.contractCancellationNotice.update({ where: { id: notice.id }, data: {
    selectedPhone: recipient.phoneNumber, status: 'PENDING', availableAt: new Date(), lastError: null,
  } });
  await tx.contractConfirmationAuditLog.create({ data: { contractId: input.contractId,
    eventType: 'CANCELLATION_NOTICE_RETRY_REQUESTED', eventPayloadJson: {
      noticeId: notice.id, requestedBy: input.actorId, phoneNumber: recipient.phoneNumber, previousStatus: notice.status,
    } } });
  return updated;
}

type Gateway = Pick<typeof smsService, 'sendContractCancellationMessage'>;

export async function deliverContractCancellationNotice(database: PrismaClient, noticeId: string, gateway: Gateway = smsService) {
  const claimed = await database.$transaction(async tx => {
    const initial = await tx.contractCancellationNotice.findUnique({ where: { id: noticeId } });
    if (!initial) return null;
    await lockNoticeOwner(tx, initial.contractId);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "contract_cancellation_notices" WHERE "id" = ${noticeId} FOR UPDATE`);
    const notice = await tx.contractCancellationNotice.findUniqueOrThrow({ where: { id: noticeId } });
    if (!pendingStatuses.includes(notice.status) || notice.availableAt > new Date()) return null;
    const { contract, recipient } = await readRecipient(tx, notice.contractId, notice.selectedPhone, notice.customerId);
    if (contract && contract.status !== 'CANCELLED') {
      await suppressContractCancellationNotices(tx, contract.id);
      return null;
    }
    if (!recipient.phoneNumber) {
      await tx.contractCancellationNotice.update({ where: { id: notice.id }, data: {
        status: recipient.status, selectedPhone: null, availableAt: new Date(Date.now() + 60_000),
      } });
      return null;
    }
    const attempt = await tx.contractCancellationNoticeAttempt.create({ data: {
      noticeId: notice.id, sequence: notice.attemptCount + 1, phoneNumber: recipient.phoneNumber, status: 'SENDING',
    } });
    await tx.contractCancellationNotice.update({ where: { id: notice.id }, data: {
      status: 'SENDING', attemptCount: attempt.sequence, lastAttemptAt: new Date(),
    } });
    return { notice, attempt };
  });
  if (!claimed) return;
  // Retain the business lock through provider submission so a completed
  // reactivation cannot race an obsolete SMS. A crash leaves a durable SENDING
  // attempt, recovered as UNKNOWN rather than automatically duplicating it.
  await database.$transaction(async tx => {
    await lockNoticeOwner(tx, claimed.notice.contractId);
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "contract_cancellation_notices" WHERE "id" = ${noticeId} FOR UPDATE`);
    const current = await tx.contractCancellationNotice.findUniqueOrThrow({ where: { id: noticeId } });
    const { contract, recipient } = await readRecipient(tx, current.contractId, current.selectedPhone, current.customerId);
    if (current.status !== 'SENDING' || contract && contract.status !== 'CANCELLED' || recipient.phoneNumber !== claimed.attempt.phoneNumber) {
      await tx.contractCancellationNoticeAttempt.update({ where: { id: claimed.attempt.id }, data: { status: 'SUPPRESSED', completedAt: new Date() } });
      if (current.status === 'SENDING') await tx.contractCancellationNotice.update({ where: { id: current.id }, data: {
        status: !contract || contract.status === 'CANCELLED' ? 'PENDING' : 'SUPPRESSED',
      } });
      return;
    }
    let result: Awaited<ReturnType<Gateway['sendContractCancellationMessage']>>;
    try { result = await gateway.sendContractCancellationMessage({ phoneNumber: claimed.attempt.phoneNumber, contractNumber: current.contractNumber }); }
    catch { result = { success: false, error: 'نتیجه ارسال پیامک مشخص نیست.', failureKind: 'NETWORK', errorCode: 'ECONNRESET' }; }
    const unknown = cancellationSubmissionIsUnknown(result);
    const status = result.success ? 'SENT' : unknown ? 'UNKNOWN' : 'FAILED';
    const detail = result.success ? null : (result.error || 'ارسال پیامک انجام نشد.').slice(0, 500);
    await tx.contractCancellationNoticeAttempt.update({ where: { id: claimed.attempt.id }, data: {
      status, completedAt: new Date(), providerMessageId: result.messageId ? String(result.messageId) : null, error: detail,
    } });
    await tx.contractCancellationNotice.update({ where: { id: current.id }, data: {
      status: result.success ? 'SENT' : unknown ? 'UNKNOWN' : current.attemptCount < 5 ? 'RETRY' : 'FAILED',
      lastError: detail, availableAt: new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** current.attemptCount)),
    } });
  }, { timeout: 45_000 });
}

export async function deliverPendingContractCancellationNotices(database: PrismaClient) {
  const stale = await database.contractCancellationNotice.findMany({ where: { status: 'SENDING',
    lastAttemptAt: { lt: new Date(Date.now() - 5 * 60_000) } }, take: 50 });
  for (const notice of stale) await database.$transaction(async tx => {
    await lockNoticeOwner(tx, notice.contractId);
    const changed = await tx.contractCancellationNotice.updateMany({ where: { id: notice.id, status: 'SENDING',
      lastAttemptAt: notice.lastAttemptAt }, data: { status: 'UNKNOWN', lastError: 'نتیجه تلاش قبلی مشخص نیست؛ پیش از ارسال مجدد بررسی کنید.' } });
    if (changed.count) await tx.contractCancellationNoticeAttempt.updateMany({ where: { noticeId: notice.id, status: 'SENDING' },
      data: { status: 'UNKNOWN', completedAt: new Date() } });
  });
  const ready = await database.contractCancellationNotice.findMany({ where: { status: { in: pendingStatuses },
    availableAt: { lte: new Date() } }, orderBy: { availableAt: 'asc' }, take: 25 });
  for (const notice of ready) {
    if (getRecoveryRuntimeState().mode !== 'NORMAL') return;
    try { await deliverContractCancellationNotice(database, notice.id); }
    catch (error) { console.error('Contract cancellation notice worker failed', { noticeId: notice.id, error }); }
  }
}

export function startContractCancellationNoticeDelivery(database: PrismaClient) {
  let running = false;
  const run = async () => {
    if (running || getRecoveryRuntimeState().mode !== 'NORMAL') return;
    running = true;
    try { await withRecoveryBackgroundWrite(() => deliverPendingContractCancellationNotices(database)); }
    catch (error) { console.error('Contract cancellation notice scan failed', error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 15_000);
  timer.unref();
  console.info('Contract cancellation notice delivery worker started', { intervalMs: 15_000 });
}
