import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { FixedTransactionClock, SandboxNotificationGateway } from '../src/testing';

test('safe gateway replays identical intent, rejects changed intent, and clock advances explicitly', async () => {
  const clock = new FixedTransactionClock('2026-08-27T08:00:00.000Z');
  assert.equal(await clock.now(), '2026-08-27T08:00:00.000Z');
  clock.advance(172800000);
  assert.equal(await clock.now(), '2026-08-29T08:00:00.000Z');
  const gateway = new SandboxNotificationGateway();
  const message = { schemaVersion: 1 as const, notificationId: 'notification-313', correlationId: 'correlation-313',
    kind: 'CUSTOMER_CONFIRMATION' as const, recipientEvidenceId: 'recipient-313', projectionEvidenceId: 'snapshot-313', notBefore: await clock.now() };
  const first = await gateway.enqueue(message);
  assert.deepEqual(await gateway.enqueue(message), first);
  assert.deepEqual(first, { ok: true, value: { deliveryId: 'sandbox-notification-313', mode: 'SANDBOX' } });
  const changed = await gateway.enqueue({ ...message, projectionEvidenceId: 'snapshot-314' });
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.error.code, 'IDEMPOTENCY_CONFLICT');
});
