import type { ContractRuntime, NotificationGateway, SafeNotification } from './contracts';

export type CustomerCancellationEvidence = {
  notification: SafeNotification;
  state: 'CANCELLED' | 'VOIDED';
  snapshotWasSent: boolean;
  snapshotWasVerified: boolean;
  contractNumber: string;
  historicalLink: string;
};

export interface CustomerCancellationOutbox {
  /** #315/#321 persist this intent WITH the committed transition and retain it
   * until an auditable success. Load immutable, allowlisted output and original
   * snapshotted recipient, never the live Customer or Partner commercial account.
   * #325 owns historical-link access/expiry; never redirect to a successor. */
  loadPending(notificationId: string): Promise<CustomerCancellationEvidence | null>;
  /** Append-only attempt history; failure must leave the intent retryable.
   * The existing channel owns delivery receipts as well as enqueue identity. */
  recordAttempt(notificationId: string, status: 'QUEUED' | 'RETRY' | 'SKIPPED', deliveryId?: string): Promise<void>;
}

export function createCustomerCancellationNotifications(
  contract: ContractRuntime, outbox: CustomerCancellationOutbox, existingCustomerChannel: NotificationGateway,
) {
  function customerNotice(evidence: CustomerCancellationEvidence) {
    if (!['CANCELLED', 'VOIDED'].includes(evidence.state)
      || !evidence.contractNumber.trim() || evidence.contractNumber.length > 100
      || !/^\/contracts\/confirm\/[A-Za-z0-9_-]+$/.test(evidence.historicalLink)) {
      throw new Error('PARTNER_CUSTOMER_NOTICE_INVALID');
    }
    // Positive allowlist, never spread a Case or underlying output snapshot.
    return { contractNumber: evidence.contractNumber, status: evidence.state, historicalLink: evidence.historicalLink };
  }
  return {
    customerNotice,
    /** Invoke only AFTER the business transaction. Even audit/storage/network
     * failure returns RETRY and can never veto cancellation or voiding. */
    async dispatch(notificationId: string): Promise<{ status: 'QUEUED' | 'RETRY' | 'SKIPPED' }> {
      try {
        contract.IdSchema.parse(notificationId);
        const evidence = await outbox.loadPending(notificationId);
        if (!evidence) return { status: 'SKIPPED' };
        const notification = contract.SafeNotificationSchema.parse(evidence.notification);
        if (notification.notificationId !== notificationId || notification.kind !== 'CUSTOMER_CANCELLED') {
          throw new Error('PARTNER_CUSTOMER_NOTICE_INVALID');
        }
        if (!evidence.snapshotWasSent && !evidence.snapshotWasVerified) {
          await outbox.recordAttempt(notificationId, 'SKIPPED');
          return { status: 'SKIPPED' };
        }
        customerNotice(evidence);
        const result = await existingCustomerChannel.enqueue(notification);
        const status = result.ok ? 'QUEUED' : 'RETRY';
        await outbox.recordAttempt(notificationId, status, result.ok ? result.value.deliveryId : undefined);
        return { status };
      } catch {
        try { await outbox.recordAttempt(notificationId, 'RETRY'); } catch { /* Pending intent is retained. */ }
        return { status: 'RETRY' };
      }
    },
  };
}
