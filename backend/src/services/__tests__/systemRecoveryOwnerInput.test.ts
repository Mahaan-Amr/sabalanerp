import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readSystemRecoveryOwnerRequest, readSealedRecoveryOwnerInput } from '../systemRecoveryOwnerInput';

const operationId = 'ck9b6eewq0000s6wx5cn6lc2e';
const deploymentId = 'deploy-20261117T123456Z-abcdef-release';

test('private sealed continuation binds the operation and action before owner admission', async () => {
  const request = { format: 'sabalan-system-recovery-owner/v1', requestId: 'a'.repeat(64), operationId,
    actorId: 'admin-1', action: 'RESTORE', packageType: 'COMPLETE', passphrase: 'Private-backup-123', checksum: 'b'.repeat(64) };
  const bytes = Buffer.from(JSON.stringify({ request, sealedSha256: 'c'.repeat(64) }));
  const input = () => Readable.from([bytes]);
  const accepted = await readSealedRecoveryOwnerInput(['--sealed', operationId, 'RESTORE'], input(), deploymentId);
  assert.deepEqual(accepted.request, request);
  for (const args of [['--sealed', operationId, 'BACKUP'], ['--sealed', 'c' + '9'.repeat(24), 'RESTORE']]) {
    await assert.rejects(readSealedRecoveryOwnerInput(args, input(), deploymentId), { message: 'SYSTEM_RECOVERY_OWNER_INPUT_INVALID' });
  }
});

test('owner accepts the exact operation ID and one bounded passphrase from stdin', async () => {
  const value = await readSystemRecoveryOwnerRequest([operationId], Readable.from([
    Buffer.from('local-'), Buffer.from('backup-12345'),
  ]), deploymentId);
  assert.deepEqual(value, { operationId, deploymentId, passphrase: 'local-backup-12345' });
});

test('owner refuses argv secrets and oversized input without disclosing the input', async () => {
  for (const [args, contents] of [
    [[operationId, 'secret-12345'], ''] as const,
    [[operationId], 'sensitive'.repeat(500)] as const,
    [[operationId + '/../test'], 'local-backup-12345'] as const,
  ]) {
    await assert.rejects(readSystemRecoveryOwnerRequest(args, Readable.from([Buffer.from(contents)]), deploymentId), {
      message: 'SYSTEM_RECOVERY_OWNER_INPUT_INVALID',
    });
  }
});

test('a request ID cannot also stand in for the protected deployment lease', async () => {
  await assert.rejects(readSystemRecoveryOwnerRequest([operationId], Readable.from([]), operationId), {
    message: 'SYSTEM_RECOVERY_OWNER_INPUT_INVALID',
  });
});
