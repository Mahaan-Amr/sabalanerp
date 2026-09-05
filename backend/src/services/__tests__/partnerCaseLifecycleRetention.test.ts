import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellationRetentionPlan } from '../partnerSales/cases/retention';

test('cancellation invalidates pending sessions and preserves verified historical snapshots', () => {
  const plan = cancellationRetentionPlan([
    { sessionId: 'pending-session', snapshotId: 'pending-snapshot', verifiedAt: null, invalidatedAt: null },
    { sessionId: 'verified-session', snapshotId: 'verified-snapshot', verifiedAt: '2026-08-30T08:00:00.000Z', invalidatedAt: null },
    { sessionId: 'old-pending', snapshotId: 'old-snapshot', verifiedAt: null, invalidatedAt: '2026-08-29T08:00:00.000Z' },
  ]);

  assert.deepEqual(plan.invalidateSessionIds, ['pending-session']);
  assert.deepEqual(plan.preserveSnapshotIds, ['verified-snapshot']);
  assert.deepEqual(plan.alreadyInvalidatedSessionIds, ['old-pending']);
});
