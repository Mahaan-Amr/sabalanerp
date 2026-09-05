export type ConfirmationRetentionRecord = {
  sessionId: string;
  snapshotId: string;
  verifiedAt: string | null;
  invalidatedAt: string | null;
};

/** Cancellation retires mutable confirmation work but never destroys a
 * verified customer-output witness. The confirmation owner applies this plan
 * in the same transaction as the Case transition. */
export function cancellationRetentionPlan(records: readonly ConfirmationRetentionRecord[]) {
  return {
    invalidateSessionIds: records
      .filter(record => !record.verifiedAt && !record.invalidatedAt)
      .map(record => record.sessionId),
    preserveSnapshotIds: records
      .filter(record => Boolean(record.verifiedAt))
      .map(record => record.snapshotId),
    alreadyInvalidatedSessionIds: records
      .filter(record => !record.verifiedAt && Boolean(record.invalidatedAt))
      .map(record => record.sessionId),
  };
}
