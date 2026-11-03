import { Prisma, type PrismaClient } from '@prisma/client';

export const CANDIDATE_SMS_REPORT_WINDOW_MS = 24 * 60 * 60_000;
export const CANDIDATE_SMS_RETRY_COOLDOWN_MS = 2 * 60_000;

export type CandidateSmsDeliveryState =
  | 'PENDING'
  | 'ACCEPTED'
  | 'DELIVERED'
  | 'FAILED'
  | 'UNKNOWN';

export type CandidateSmsAttemptView = {
  id: string;
  providerDeliveryState: CandidateSmsDeliveryState;
  createdAt: Date;
};

export type CandidateSmsPurpose = 'INVITATION' | 'CORRECTION' | 'OFFER';

export const mapSmsIrDeliveryState = (deliveryState?: number | null): CandidateSmsDeliveryState => {
  if (deliveryState === 1) return 'DELIVERED';
  if ([2, 4, 6, 7].includes(Number(deliveryState))) return 'FAILED';
  if ([3, 5].includes(Number(deliveryState))) return 'ACCEPTED';
  return 'UNKNOWN';
};

export const candidateSmsInitialState = (input: {
  success: boolean;
  messageId?: number | string | null;
  failureKind?: 'PROVIDER_REJECTION' | 'HTTP' | 'NETWORK';
  httpStatus?: number;
}): CandidateSmsDeliveryState => {
  if (input.success) return input.messageId == null ? 'UNKNOWN' : 'ACCEPTED';
  if (input.failureKind === 'NETWORK') return 'UNKNOWN';
  if (input.failureKind === 'HTTP' && Number(input.httpStatus) >= 500) return 'UNKNOWN';
  return 'FAILED';
};

export type CandidateSmsRetryReason =
  | 'NO_ATTEMPT'
  | 'DELIVERED'
  | 'PENDING'
  | 'REPORT_WINDOW_ACTIVE'
  | 'COOLDOWN'
  | 'FAILED'
  | 'UNKNOWN_AFTER_REPORT_WINDOW';

const newestFirst = <T extends CandidateSmsAttemptView>(attempts: T[]) =>
  [...attempts].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

export const candidateSmsDeliverySummary = (
  attempts: CandidateSmsAttemptView[],
  _now = new Date(),
) => {
  const ordered = newestFirst(attempts);
  const delivered = ordered.find((attempt) => attempt.providerDeliveryState === 'DELIVERED');
  return {
    state: delivered ? 'DELIVERED' as const : ordered[0]?.providerDeliveryState || 'UNKNOWN' as const,
    latestAttemptId: ordered[0]?.id || null,
    deliveredAttemptId: delivered?.id || null,
  };
};

export const candidateSmsRetryEligibility = (
  attempts: CandidateSmsAttemptView[],
  now = new Date(),
): { allowed: boolean; reason: CandidateSmsRetryReason; availableAt: Date | null } => {
  const summary = candidateSmsDeliverySummary(attempts, now);
  if (summary.deliveredAttemptId) return { allowed: false, reason: 'DELIVERED', availableAt: null };
  const latest = newestFirst(attempts)[0];
  if (!latest) return { allowed: true, reason: 'NO_ATTEMPT', availableAt: null };
  const cooldownAt = new Date(latest.createdAt.getTime() + CANDIDATE_SMS_RETRY_COOLDOWN_MS);
  if (cooldownAt > now) return { allowed: false, reason: 'COOLDOWN', availableAt: cooldownAt };
  if (latest.providerDeliveryState === 'PENDING') {
    const recoveryAt = new Date(latest.createdAt.getTime() + CANDIDATE_SMS_REPORT_WINDOW_MS);
    return recoveryAt <= now
      ? { allowed: true, reason: 'UNKNOWN_AFTER_REPORT_WINDOW', availableAt: null }
      : { allowed: false, reason: 'PENDING', availableAt: recoveryAt };
  }
  if (latest.providerDeliveryState === 'FAILED') return { allowed: true, reason: 'FAILED', availableAt: null };
  if (['ACCEPTED', 'UNKNOWN'].includes(latest.providerDeliveryState)) {
    const reportWindowAt = new Date(latest.createdAt.getTime() + CANDIDATE_SMS_REPORT_WINDOW_MS);
    return reportWindowAt <= now
      ? { allowed: true, reason: 'UNKNOWN_AFTER_REPORT_WINDOW', availableAt: null }
      : { allowed: false, reason: 'REPORT_WINDOW_ACTIVE', availableAt: reportWindowAt };
  }
  return { allowed: false, reason: 'PENDING', availableAt: null };
};

export const claimCandidateSmsAttempt = async (input: {
  prisma: PrismaClient;
  applicationId: string;
  purpose: CandidateSmsPurpose;
  referenceId: string;
  initiatedByUserId?: string | null;
  initiatedByKind?: 'USER' | 'SYSTEM';
  isRetry?: boolean;
  now?: Date;
}) => input.prisma.$transaction(async (tx) => {
  const now = input.now ?? new Date();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "hr_job_applications" WHERE "id" = ${input.applicationId} FOR UPDATE`);
  const attempts = await tx.hrCandidateSmsAttempt.findMany({
    where: { purpose: input.purpose, referenceId: input.referenceId },
    orderBy: { attemptNumber: 'desc' },
  });
  if (input.isRetry) {
    const eligibility = candidateSmsRetryEligibility(attempts.map((attempt) => ({
      id: attempt.id,
      createdAt: attempt.createdAt,
      providerDeliveryState: attempt.providerDeliveryState as CandidateSmsDeliveryState,
    })), now);
    if (!eligibility.allowed) {
      const error = new Error('ارسال مجدد در وضعیت فعلی مجاز نیست.') as Error & { code?: string; eligibility?: typeof eligibility };
      error.code = 'CANDIDATE_SMS_RETRY_NOT_ALLOWED';
      error.eligibility = eligibility;
      throw error;
    }
  } else if (attempts.length) {
    throw new Error('تلاش اولیه این اعلان قبلاً ثبت شده است.');
  }
  const previous = attempts[0];
  return tx.hrCandidateSmsAttempt.create({ data: {
    applicationId: input.applicationId,
    purpose: input.purpose,
    referenceId: input.referenceId,
    attemptNumber: (previous?.attemptNumber ?? 0) + 1,
    providerDeliveryState: 'PENDING',
    initiatedByUserId: input.initiatedByUserId ?? null,
    initiatedByKind: input.initiatedByKind ?? 'USER',
    retryOfAttemptId: input.isRetry ? previous?.id ?? null : null,
    createdAt: now,
  } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const finalizeCandidateSmsAttempt = async (input: {
  prisma: PrismaClient;
  attemptId: string;
  success: boolean;
  messageId?: number | string | null;
  error?: string | null;
  failureKind?: 'PROVIDER_REJECTION' | 'HTTP' | 'NETWORK';
  httpStatus?: number;
  rawResponse?: unknown;
  now?: Date;
}) => input.prisma.hrCandidateSmsAttempt.update({
  where: { id: input.attemptId },
  data: {
    providerMessageId: input.messageId == null ? null : String(input.messageId),
    providerDeliveryState: candidateSmsInitialState(input),
    providerFailureKind: input.failureKind ?? null,
    providerHttpStatus: input.httpStatus ?? null,
    providerResultJson: input.rawResponse === undefined
      ? undefined
      : JSON.parse(JSON.stringify(input.rawResponse)) as Prisma.InputJsonValue,
    providerLastCheckedAt: input.now ?? new Date(),
    immediateError: input.success ? null : input.error || 'درگاه SMS.ir ارسال را نپذیرفت.',
  },
});
