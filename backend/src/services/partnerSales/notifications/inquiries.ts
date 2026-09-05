import type { ContractRuntime, InquiryBatchResult, InquiryNoticeType, SafeNotification, TransactionClock } from './contracts';
import { inquiryNoticeKinds } from './contracts';

export type InquiryNotificationCause = {
  type: InquiryNoticeType;
  /** Immutable committed cause identity, not a scheduler run or request ID. */
  eventId: string;
  correlationId: string;
  occurredAt: string;
  recipients: ReadonlyArray<{
    audience: 'PARTNER' | 'RESPONDER';
    recipientEvidenceId: string;
    projectionEvidenceId: string;
  }>;
  batch?: InquiryBatchResult;
  approval?: { approvedAt: string; expiresAt: string; superseded: boolean; terminated: boolean };
};

/** Called with committed evidence and a transaction-owned DB clock. This only
 * plans delivery; it never writes approval validity or inquiry lifecycle. */
export async function planInquiryNotifications(
  contract: ContractRuntime, clock: TransactionClock, cause: InquiryNotificationCause,
): Promise<SafeNotification[]> {
  contract.IdSchema.parse(cause.eventId);
  contract.IdSchema.parse(cause.correlationId);
  contract.InstantSchema.parse(cause.occurredAt);
  const now = contract.InstantSchema.parse(await clock.now());
  if (now < cause.occurredAt) return [];
  let notBefore = cause.occurredAt;
  if (cause.type === 'EXPIRING' || cause.type === 'EXPIRED') {
    const approval = cause.approval;
    if (!approval || approval.superseded || approval.terminated) return [];
    const approvedAt = contract.InstantSchema.parse(approval.approvedAt);
    const expiresAt = contract.InstantSchema.parse(approval.expiresAt);
    if (Date.parse(expiresAt) - Date.parse(approvedAt) !== 48 * 60 * 60 * 1000) {
      throw new Error('PARTNER_APPROVAL_TIME_CONFLICT');
    }
    notBefore = cause.type === 'EXPIRED'
      ? expiresAt : new Date(Date.parse(expiresAt) - 6 * 60 * 60 * 1000).toISOString();
    if (now < notBefore || (cause.type === 'EXPIRING' && now >= expiresAt)) return [];
  }
  if (cause.type === 'PARTIAL_RESPONSE') {
    const batch = contract.InquiryBatchResultSchema.parse(cause.batch);
    if (!batch.outcomes.some(row => row.ok)) return [];
  }
  const results = new Map<string, SafeNotification>();
  for (const recipient of cause.recipients) {
    if (cause.type === 'SUBMITTED' || cause.type === 'CANCELLED') {
      if (recipient.audience !== 'RESPONDER') continue;
    } else if (cause.type !== 'REASSIGNED' && recipient.audience !== 'PARTNER') continue;
    const identity = await contract.canonicalHash({
      purpose: 'PARTNER_INQUIRY_NOTIFICATION', schemaVersion: 1,
      eventId: cause.eventId, type: cause.type, recipientEvidenceId: recipient.recipientEvidenceId,
    });
    const notice = contract.SafeNotificationSchema.parse({
      schemaVersion: 1, notificationId: identity, correlationId: cause.correlationId,
      kind: inquiryNoticeKinds[cause.type], recipientEvidenceId: recipient.recipientEvidenceId,
      projectionEvidenceId: recipient.projectionEvidenceId, notBefore,
    });
    results.set(identity, notice);
  }
  return [...results.values()];
}
