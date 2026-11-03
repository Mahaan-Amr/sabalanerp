import type { NotificationGateway } from '../../../../../packages/partner-sales-contracts';
import {
  BusinessIdentity, ContractRuntime, CurrentOutput, CustomerOutputError, Notification, Output,
  Result, Snapshot, requireValue,
} from './contracts';
import { createCustomerOutputSnapshots } from './snapshots';

export type ConfirmationSession = {
  snapshot: Snapshot;
  verifiedAt: string | null;
  invalidated: boolean;
};

export type ConfirmationSource = CurrentOutput & {
  business: BusinessIdentity;
  retail: Omit<Output, 'seller' | 'outputHash'>;
};

/** Implemented with the existing confirmation session/token/lookup/OTP service
 * in #334. This is not a second OTP implementation or an authentication scheme. */
export interface CustomerConfirmationTransaction {
  now(): Promise<string>;
  source(): Promise<ConfirmationSource>;
  session(): Promise<ConfirmationSession | null>;
  /** Allocates snapshot identity and the ordinary link expiry at send time. */
  snapshotIdentity(): Promise<{ snapshotId: string; expiresAt: string }>;
  invalidatePending(): Promise<void>;
  installSnapshot(snapshot: Snapshot): Promise<void>;
  /** Existing resend cooldown, OTP rotation/attempt policy and encrypted secret
   * handling apply. Enqueue and audit are durable in this SAME transaction. */
  queueConfirmation(snapshot: Snapshot): Promise<Notification>;
  /** The existing verifier owns code hashing, expiry, attempts and consumption;
   * it must bind verification to this session, snapshot and recipient under lock. */
  verifyOtp(code: string): Promise<Result<{ verifiedAt: string }>>;
  /** Calls Case CUSTOMER_APPROVED, never CASE_COMMIT or PRINTED. */
  markCustomerApproved(snapshot: Snapshot, verifiedAt: string): Promise<void>;
}

export interface CustomerConfirmationStore {
  /** Resolves existing token OR contract-number/phone lookup identically. The
   * factory is principal/session-bound, not caller-supplied actor authority.
   * Serialize with Case changes and rollback all writes when work throws.
   * Preserve invalid OTP attempts even when returning a failed Result. */
  transaction<T>(action: 'SEND' | 'READ' | 'VERIFY', work: (tx: CustomerConfirmationTransaction) => Promise<T>): Promise<Result<T>>;
  /** Immutable, pending outbox reference; no raw OTP, token, body or phone. */
  notification(notificationId: string): Promise<Result<Notification>>;
  recordNotificationAttempt(notificationId: string, result: 'QUEUED' | 'RETRY', deliveryId?: string): Promise<void>;
}

export function createCustomerConfirmationAdapter(
  contract: ContractRuntime, store: CustomerConfirmationStore, notifications: NotificationGateway,
) {
  const snapshots = createCustomerOutputSnapshots(contract);
  async function run<T>(action: 'SEND' | 'READ' | 'VERIFY', work: (tx: CustomerConfirmationTransaction) => Promise<T>): Promise<Result<T>> {
    try {
      return await store.transaction(action, work);
    } catch (error) {
      return { ok: false, error: contract.partnerError(error instanceof CustomerOutputError ? error.code : 'INTEGRITY_CONFLICT') };
    }
  }

  async function readSession(tx: CustomerConfirmationTransaction) {
    const session = await tx.session();
    if (!session || (session.invalidated && !session.verifiedAt)) throw new CustomerOutputError('NOT_FOUND');
    const snapshot = await snapshots.read(session.snapshot);
    const disposition = snapshots.disposition(snapshot, await tx.source(), session.verifiedAt, await tx.now());
    return { session, snapshot, disposition };
  }

  return {
    sendForConfirmation() {
      return run('SEND', async tx => {
        const source = await tx.source();
        if (source.state !== 'DRAFT' && source.state !== 'AWAITING_CUSTOMER_CONFIRMATION') throw new CustomerOutputError('STATE_CONFLICT');
        if (source.retail.contractNumber !== source.contractNumber || source.retail.revision !== source.owner.revision) throw new CustomerOutputError('INTEGRITY_CONFLICT');
        const now = await tx.now();
        const previous = await tx.session();
        let snapshot: Snapshot | undefined;
        if (previous && !previous.invalidated && !previous.verifiedAt) {
          const existing = await snapshots.read(previous.snapshot);
          if (existing.owner.caseId !== source.owner.caseId || existing.content.contractNumber !== source.contractNumber
            || existing.owner.revision > source.owner.revision
            || (existing.owner.revision === source.owner.revision && existing.owner.integrityHash !== source.owner.integrityHash)) {
            throw new CustomerOutputError('INTEGRITY_CONFLICT');
          }
          if (existing.expiresAt > now && existing.normalizedRecipient === source.normalizedRecipient
            && !contract.checkExpectedRevision(existing.owner, source.owner)) {
            // Do not rebuild from current relations or extend the original TTL.
            snapshot = existing;
          }
        }
        if (!snapshot) {
          const identity = await tx.snapshotIdentity();
          snapshot = await snapshots.mint({
            snapshotId: identity.snapshotId, owner: source.owner,
            normalizedRecipient: source.normalizedRecipient, createdAt: now,
            expiresAt: identity.expiresAt, business: source.business,
            retail: { ...source.retail, status: 'PENDING_APPROVAL', confirmation: 'PENDING' },
          });
          await tx.invalidatePending();
          await tx.installSnapshot(snapshot);
        }
        const notification = contract.SafeNotificationSchema.parse(await tx.queueConfirmation(snapshot));
        if (notification.kind !== 'CUSTOMER_CONFIRMATION' || notification.projectionEvidenceId !== snapshot.snapshotId) {
          throw new CustomerOutputError('INTEGRITY_CONFLICT');
        }
        // Private command result for the existing service, not the public DTO.
        return { snapshotId: snapshot.snapshotId, notificationId: notification.notificationId };
      });
    },

    getPublicContract() {
      return run('READ', async tx => {
        const { session, snapshot, disposition } = await readSession(tx);
        return {
          contract: snapshot.content,
          verifiedAt: session.verifiedAt,
          linkExpiresAt: snapshot.expiresAt,
          readOnly: disposition.readOnly,
          banner: disposition.banner,
        };
      });
    },

    verifyPublicOtp(code: string) {
      return run('VERIFY', async tx => {
        const { session, snapshot, disposition } = await readSession(tx);
        if (disposition.banner) throw new CustomerOutputError('ROW_STALE');
        if (session.verifiedAt) return { ok: true as const, value: { status: 'APPROVED' as const } };
        const verified = await tx.verifyOtp(code);
        // Returning (not throwing) preserves the existing verifier's attempt count.
        if (!verified.ok) return verified;
        // Recheck as pending: successful OTP does not grandfather a cancellation
        // or revision/recipient change which won before approval was recorded.
        const current = await tx.source();
        const now = await tx.now();
        snapshots.disposition(snapshot, current, null, now);
        snapshots.disposition(snapshot, current, verified.value.verifiedAt, now);
        await tx.markCustomerApproved(snapshot, verified.value.verifiedAt);
        return { ok: true as const, value: { status: 'APPROVED' as const } };
      }).then(result => result.ok ? result.value : result);
    },

    /** Retry the durable notification reference after the commercial transaction.
     * Gateway/network failure never rolls back or recreates the snapshot. */
    async dispatchNotification(notificationId: string): Promise<Result<{ queued: boolean }>> {
      try {
        contract.IdSchema.parse(notificationId);
        const notification = contract.SafeNotificationSchema.parse(requireValue(await store.notification(notificationId)));
        if (notification.notificationId !== notificationId || notification.kind !== 'CUSTOMER_CONFIRMATION') {
          throw new CustomerOutputError('INTEGRITY_CONFLICT');
        }
        let delivery: Awaited<ReturnType<NotificationGateway['enqueue']>>;
        try {
          delivery = await notifications.enqueue(notification);
        } catch {
          await store.recordNotificationAttempt(notificationId, 'RETRY');
          return { ok: true, value: { queued: false } };
        }
        if (delivery.ok) contract.IdSchema.parse(delivery.value.deliveryId);
        await store.recordNotificationAttempt(notificationId, delivery.ok ? 'QUEUED' : 'RETRY', delivery.ok ? delivery.value.deliveryId : undefined);
        return { ok: true, value: { queued: delivery.ok } };
      } catch (error) {
        return { ok: false, error: contract.partnerError(error instanceof CustomerOutputError ? error.code : 'INTEGRITY_CONFLICT') };
      }
    },
  };
}
