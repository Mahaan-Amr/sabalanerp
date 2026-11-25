import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';
import { verifySepidarOpeningApproval } from './sepidar-opening-approval.mjs';

test('a protected approval includes exactly the signed accounting commands and release evidence', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const identity = {
    releaseId: 'release-1', deploymentId: 'deployment-1', buildCommit: 'a'.repeat(40), migrationSha256: '3'.repeat(64),
    candidateImage: 'sha256:' + '1'.repeat(64), retainedImage: 'sha256:' + '2'.repeat(64),
    checkpointHash: '4'.repeat(64), qualificationHash: '5'.repeat(64),
  };
  const payload = {
    ...identity,
    format: 'sepidar-customer-opening-approval-v1',
    decision: 'GO',
    keyId: 'accounting-approval',
    issuedAt: '2026-11-25T10:00:00.000Z', expiresAt: '2026-11-25T10:05:00.000Z',
    bookId: 'book', counterAccountId: 'clearing', basisAt: '2026-03-21T00:00:00.000Z',
    sourcePackageHash: 'b'.repeat(64), accountingApprovalHash: 'c'.repeat(64),
    commands: [{ idempotencyKey: 'opening-91', profileId: 'p91', actorId: 'accountant', sourceCustomerId: '7',
      sourceVoucherItemId: '91', commandHash: 'd'.repeat(64), totalRials: '-5' }],
  };
  const envelope = {
    payload,
    signature: sign(null, Buffer.from(canonicalGoPayload(payload)), privateKey).toString('base64'),
  };
  const observed = { ...identity, bookId: payload.bookId, counterAccountId: payload.counterAccountId,
    sourcePackageHash: payload.sourcePackageHash, accountingApprovalHash: payload.accountingApprovalHash, phase: 'MIGRATIONS_APPLIED', activeKey: 'production',
    dbClock: '2026-11-25T10:00:45.000Z', leaseExpiresAt: '2026-11-25T10:05:00.000Z' };
  const approver = { keyId: 'accounting-approval', publicKey };
  const result = verifySepidarOpeningApproval(envelope, observed, approver);
  assert.deepEqual(JSON.parse(result.manifestText), payload);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => verifySepidarOpeningApproval({
    ...envelope, payload: { ...payload, commands: [{ ...payload.commands[0], totalRials: '-6' }] },
  }, observed, approver), /SEPIDAR_OPENING_APPROVAL_REJECTED/);
  assert.throws(() => verifySepidarOpeningApproval(envelope, {
    ...observed, retainedImage: 'sha256:' + '8'.repeat(64),
  }, approver), /SEPIDAR_OPENING_APPROVAL_REJECTED/);
});
