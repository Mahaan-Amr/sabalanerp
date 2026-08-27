import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createCustomerCancellationNotifications } from '../partnerSales/notifications/customerCancellation';

const load = createRequire(resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract: typeof import('../../../../packages/partner-sales-contracts') = load('@sabalanerp/partner-sales-contracts');

test('customer cancellation retries are non-vetoing and contain only safe customer evidence', async () => {
  const attempts: string[] = [];
  const notification = {
    schemaVersion: 1 as const, notificationId: 'customer-notice-327', correlationId: 'cause-327',
    kind: 'CUSTOMER_CANCELLED' as const, recipientEvidenceId: 'historical-recipient-327',
    projectionEvidenceId: 'historical-output-327', notBefore: '2026-08-27T10:00:00.000Z',
  };
  const source = {
    notification, state: 'VOIDED' as const, snapshotWasSent: true, snapshotWasVerified: true,
    contractNumber: 'PC-1405-327', historicalLink: '/contracts/confirm/historical-session',
  };
  let fail = true;
  let auditFails = false;
  const adapter = createCustomerCancellationNotifications(contract, {
    async loadPending() { return source; },
    async recordAttempt(_id, status) { if (auditFails) throw new Error('private database detail'); attempts.push(status); },
  }, {
    async enqueue(value) {
      assert.deepEqual(value, notification);
      if (fail) throw new Error('private gateway detail');
      return { ok: true, value: { deliveryId: 'delivery-327', mode: 'SANDBOX' } };
    },
  });
  assert.deepEqual(await adapter.dispatch(notification.notificationId), { status: 'RETRY' });
  fail = false;
  assert.deepEqual(await adapter.dispatch(notification.notificationId), { status: 'QUEUED' });
  assert.deepEqual(attempts, ['RETRY', 'QUEUED']);
  auditFails = true;
  assert.deepEqual(await adapter.dispatch(notification.notificationId), { status: 'RETRY' });
  const projection = adapter.customerNotice(source);
  assert.deepEqual(projection, { contractNumber: 'PC-1405-327', status: 'VOIDED', historicalLink: '/contracts/confirm/historical-session' });
});

test('unsent snapshots are silent and historical notices reject changed identity or unsafe links', async () => {
  const notification = { schemaVersion: 1 as const, notificationId: 'notice-327', correlationId: 'cause-327', kind: 'CUSTOMER_CANCELLED' as const,
    recipientEvidenceId: 'recipient-327', projectionEvidenceId: 'projection-327', notBefore: '2026-08-27T10:00:00.000Z' };
  const evidence = { notification, state: 'CANCELLED' as const, snapshotWasSent: false, snapshotWasVerified: false,
    contractNumber: 'PC-327', historicalLink: '/contracts/confirm/history' };
  const delivered: unknown[] = [];
  const adapter = createCustomerCancellationNotifications(contract, {
    async loadPending() { return evidence; }, async recordAttempt() {},
  }, { async enqueue(value) { delivered.push(value); return { ok: true, value: { mode: 'SANDBOX', deliveryId: 'delivery' } }; } });
  assert.deepEqual(await adapter.dispatch('notice-327'), { status: 'SKIPPED' });
  assert.deepEqual(await adapter.dispatch('different-notice'), { status: 'RETRY' });
  assert.deepEqual(delivered, []);
  assert.throws(() => adapter.customerNotice({ ...evidence, historicalLink: 'https://foreign.invalid/secret' }));
});
