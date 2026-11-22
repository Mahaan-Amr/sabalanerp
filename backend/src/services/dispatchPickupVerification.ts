import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePlateDigits } from './companyVehicleEntry';
import { assertCanonicalDispatchCommandAllowed } from './dispatchCutover';
import { customerPickupPhone } from './guardDriverQueue';

export class DispatchPickupVerificationError extends Error {}

const verificationRequired = 'ابتدا شماره همراه راننده متفرقه را با کد پیامکی تأیید کنید.';
const minute = 60_000;

export async function requirePickupVerification(
  tx: Prisma.TransactionClient,
  candidateId: string,
  source: string | undefined,
  ConflictError: new (message: string) => Error,
) {
  if (source !== 'CUSTOMER_PICKUP') return null;
  const verified = await tx.dispatchPickupVerification.findUnique({ where: { candidateId },
    select: { challengeId: true, verifiedAt: true, verifiedBy: true } });
  if (!verified?.verifiedAt || !verified.verifiedBy) throw new ConflictError(verificationRequired);
  return { challengeId: verified.challengeId, verifiedAt: verified.verifiedAt.toISOString(), verifiedBy: verified.verifiedBy };
}

export async function processPickupVerification(prisma: PrismaClient, input: {
  candidateId: string;
  actorId: string;
  command: 'SEND' | 'VERIFY';
  code?: unknown;
  secret: string;
  authorizePartnerCase(tx: Prisma.TransactionClient, caseId: string): Promise<boolean>;
  sendSms(phone: string, code: string, reference: string): Promise<boolean>;
}) {
  if (input.secret.length < 16) throw new DispatchPickupVerificationError('تنظیمات ارسال کد پیامکی در دسترس نیست.');
  const code = input.command === 'SEND' ? String(randomInt(0, 1_000_000)).padStart(6, '0')
    : typeof input.code === 'string' ? normalizePlateDigits(input.code.trim()) : '';
  if (!/^\d{6}$/.test(code)) throw new DispatchPickupVerificationError('کد پیامکی شش‌رقمی را وارد کنید.');
  const digest = (id: string) => createHmac('sha256', input.secret).update(`pickup:${input.candidateId}:${id}:${code}`).digest();

  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ACCOUNTING_DISPATCH_CANDIDATE:${input.candidateId}`}))`;
    const candidate = await tx.accountingDispatchCandidate.findUnique({
      where: { id: input.candidateId },
      include: { allocationRevision: { include: { queueTurn: true, loading: { select: { status: true, loadingNumber: true } } } } },
    });
    const revision = candidate?.allocationRevision;
    if (!candidate || !revision || revision.queueTurn.driverSource !== 'CUSTOMER_PICKUP' ||
        candidate.status !== 'PENDING' || !revision.sealedAt || revision.loading.status !== 'FINALIZED' ||
        revision.queueTurn.status !== 'LOADING_FINALIZED') {
      throw new DispatchPickupVerificationError('تخصیص نهایی راننده متفرقه برای تأیید در دسترس نیست.');
    }
    if (revision.sourceKind === 'PARTNER_CASE' &&
        (!revision.partnerCaseId || !await input.authorizePartnerCase(tx, revision.partnerCaseId))) return { denied: true };
    await assertCanonicalDispatchCommandAllowed(tx);
    const phone = customerPickupPhone(revision.queueTurn.admissionSnapshot);
    if (!phone) throw new DispatchPickupVerificationError('شماره همراه ثبت‌شده در پذیرش معتبر نیست.');

    const candidateId = candidate.id;
    const current = await tx.dispatchPickupVerification.findUnique({ where: { candidateId } });
    if (current?.verifiedAt) return { verified: true };
    const now = new Date();
    if (input.command === 'VERIFY') {
      if (!current || current.expiresAt <= now || current.attempts >= 5)
        throw new DispatchPickupVerificationError('مهلت یا تعداد تلاش کد به پایان رسیده است. کد جدید درخواست کنید.');
      const matches = timingSafeEqual(digest(current.challengeId), Buffer.from(current.digest, 'hex'));
      await tx.dispatchPickupVerification.update({ where: { candidateId }, data: matches
        ? { verifiedAt: now, verifiedBy: input.actorId }
        : { attempts: { increment: 1 } } });
      return { verified: matches };
    }

    const sameWindow = Boolean(current && current.windowStart.getTime() + 60 * minute > now.getTime());
    if (current && (current.resendAfter > now || (sameWindow && current.sendCount >= 5)))
      throw new DispatchPickupVerificationError('درخواست‌های پیامک بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.');
    const challengeId = randomUUID();
    const challenge = {
      challengeId,
      digest: digest(challengeId).toString('hex'),
      expiresAt: new Date(now.getTime() + 10 * minute),
      resendAfter: new Date(now.getTime() + minute),
      attempts: 0,
      sendCount: sameWindow && current ? current.sendCount + 1 : 1,
      windowStart: sameWindow && current ? current.windowStart : now,
    };
    await tx.dispatchPickupVerification.upsert({ where: { candidateId }, create: { candidateId, ...challenge }, update: challenge });
    return { phone, reference: revision.loading.loadingNumber };
  });

  if (result.denied) return { denied: true };
  if (result.phone) {
    if (!await input.sendSms(result.phone, code, result.reference))
      throw new DispatchPickupVerificationError('ارسال پیامک ناموفق بود. پس از یک دقیقه دوباره تلاش کنید.');
    return { verified: false };
  }
  if (!result.verified) throw new DispatchPickupVerificationError('کد پیامکی درست نیست.');
  return { verified: true };
}
