import { strict as assert } from 'node:assert';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readSystemRecoveryOwnerRequest } from '../systemRecoveryOwnerInput';

const operationId = 'ck9b6eewq0000s6wx5cn6lc2e';
const deploymentId = 'deploy-20261117T123456Z-abcdef-release';

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
