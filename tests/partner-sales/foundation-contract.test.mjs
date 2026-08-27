import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFoundation } from './harness/foundation.mjs';

test('QA consumes the foundation clock at the exact inquiry expiry boundary', async () => {
  const { contract, testing } = loadFoundation();
  const { approval } = testing.createPartnerFixtures();
  const clock = new testing.FixedTransactionClock(new Date(Date.parse(approval.expiresAt) - 1).toISOString());
  const use = { partnerSellerId: approval.partnerSellerId, configurationHash: approval.configurationHash, superseded: false, terminated: false };
  assert.equal(contract.checkApprovalUse(approval, use, await clock.now()), null);
  clock.advance(1);
  assert.equal(contract.checkApprovalUse(approval, use, await clock.now()).code, 'APPROVAL_EXPIRED');
});

test('QA uses the approved memory sandbox; retry is stable and raw OTP is rejected', async () => {
  const { testing } = loadFoundation();
  const sandbox = new testing.SandboxNotificationGateway();
  const notification = { schemaVersion: 1, notificationId: 'qa-314-notification', correlationId: 'qa-314-correlation',
    kind: 'CUSTOMER_CONFIRMATION', recipientEvidenceId: 'qa-314-recipient', projectionEvidenceId: 'qa-314-output', notBefore: '2026-08-27T08:00:00.000Z' };
  const first = await sandbox.enqueue(notification);
  assert.equal(first.ok, true);
  assert.equal(first.value.mode, 'SANDBOX');
  assert.deepEqual(await sandbox.enqueue(notification), first);
  assert.equal((await sandbox.enqueue({ ...notification, projectionEvidenceId: 'different-output' })).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await sandbox.enqueue({ ...notification, otp: 'never-send-this' })).error.code, 'INVALID_PAYLOAD');
});

test('QA fixture consumer stays on its published query purpose without treating it as production authorization', async () => {
  const { testing, contract } = loadFoundation();
  const fixtures = testing.createPartnerFixtures();
  const adapter = new testing.FixturePartnerQueryAdapter(['PARTNER_CASE']);
  const result = await adapter.query({ schemaVersion: 1, purpose: 'PARTNER_CASE', expected: fixtures.case.head });
  assert.equal(result.ok, true);
  assert.equal(result.value.purpose, 'PARTNER_CASE');
  const hidden = await adapter.query({ schemaVersion: 1, purpose: 'ACCOUNTING', expected: fixtures.case.head });
  assert.equal(hidden.error.code, 'NOT_FOUND');
  assert.equal(contract.CustomerContractOutputSchema.safeParse({ ...fixtures.customer, wholesaleUnitPrice: '800' }).success, false);
});
