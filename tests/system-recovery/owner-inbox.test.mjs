import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { decodeOwnerInbox, assertOwnedRecoveryContainer, recoveryMutationWithinBudget } from '../../deploy/scripts/system-recovery-owner-host.mjs';
import { assertApplicationRecoveryStart } from '../../deploy/scripts/capture-only-release.mjs';
const { seal } = createRequire(import.meta.url)('../../backend/scripts/system-recovery-envelope.cjs');

test('the mutation deadline permits stopping only the exact original owner container', () => {
  const expected = { name: 'sabalanerp-recovery-owner-deploy-one', image: 'sha256:' + 'a'.repeat(64),
    deploymentId: 'deploy-one', operationId: 'c' + '1'.repeat(24) };
  const container = { Id: 'b'.repeat(64), Name: '/' + expected.name, Image: expected.image,
    Config: { Labels: { 'com.docker.compose.project': 'sabalanerp', 'com.docker.compose.service': 'deployment',
      'io.sabalan.deployment.id': expected.deploymentId }, Cmd: ['sh', 'scripts/with-backend-control-ownership.sh',
        'node', 'dist/scripts/system-recovery-owner.js', '--sealed', expected.operationId, 'RESTORE'] } };
  assert.equal(assertOwnedRecoveryContainer(container, expected), container.Id);
  assert.throws(() => assertOwnedRecoveryContainer({ ...container, Image: 'sha256:' + 'c'.repeat(64) }, expected));
  assert.throws(() => assertOwnedRecoveryContainer({ ...container, Name: '/another-task' }, expected));
  assert.equal(recoveryMutationWithinBudget(0n, 899_000_000_000n), true);
  assert.equal(recoveryMutationWithinBudget(0n, 900_000_000_000n), false);
});

test('restored original containers require the matching completed owner receipt and release-started lease', () => {
  const session = { deploymentId: 'deploy-current', phase: 'RELEASE_STARTED' };
  const intent = { deploymentId: session.deploymentId, operationId: 'c' + '1'.repeat(24) };
  const receipt = { format: 'sabalan-system-recovery-owner-completion/v1', ...intent, ownerCompleted: true, outcome: 'COMPLETED',
    allocation: { sha256: 'a'.repeat(64) } };
  assertApplicationRecoveryStart(session, intent, receipt);
  assert.throws(() => assertApplicationRecoveryStart({ ...session, phase: 'SERVICES_DRAINED' }, intent, receipt));
  assert.throws(() => assertApplicationRecoveryStart(session, intent, { ...receipt, ownerCompleted: false }));
  assert.throws(() => assertApplicationRecoveryStart(session, { ...intent, operationId: 'c' + '2'.repeat(24) }, receipt));
  const rollback = { ...receipt, outcome: 'ROLLED_BACK', checkpointChecksum: 'b'.repeat(64) };
  assertApplicationRecoveryStart({ ...session, phase: 'ROLLBACK_STARTED' }, intent, rollback, true);
  assert.throws(() => assertApplicationRecoveryStart({ ...session, phase: 'ROLLBACK_STARTED' }, intent, receipt, true));
});

test('host consumer binds decrypted inbox bytes to the queued operation and private runner stream', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const id = 'c' + '1'.repeat(24);
  const request = { format: 'sabalan-system-recovery-owner/v1', requestId: 'a'.repeat(64), operationId: id,
    action: 'RESTORE', packageType: 'COMPLETE', actorId: 'admin', passphrase: 'Private-recovery-123', checksum: 'b'.repeat(64) };
  const sealed = seal(request, keys.publicKey);
  const decoded = decodeOwnerInbox(id, sealed, keys.privateKey);
  assert.deepEqual(JSON.parse(decoded.input.toString()).request, request);
  assert.equal(decoded.action, 'RESTORE');
  assert.throws(() => decodeOwnerInbox('c' + '2'.repeat(24), sealed, keys.privateKey));
  assert.throws(() => decodeOwnerInbox(id, Buffer.concat([sealed, Buffer.alloc(32768)]), keys.privateKey));
});
