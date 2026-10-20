import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Dispatch recovery CLI refuses an unowned registered fleet before SQL or filesystem mutation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sabalan-dispatch-boundary-'));
  const online = path.join(root, 'online'), native = path.join(online, 'native');
  mkdirSync(online, { mode: 0o700 }); mkdirSync(native, { mode: 0o700 });
  const registration = path.join(native, 'retained-native.json');
  const original = Buffer.from('{"phase":"ACTIVE","testEvidence":true}\n');
  writeFileSync(registration, original, { mode: 0o600, flag: 'wx' });
  const repository = path.resolve(__dirname, '../../../..');
  const command = path.join(repository, 'backend/scripts/dispatch-document-recovery.ts');
  try {
    const result = spawnSync(process.execPath, [path.join(repository, 'backend/node_modules/tsx/dist/cli.mjs'), command,
      '--command', 'reconcile', '--actor-id', 'private-admin', '--subject-id', 'private-subject',
      '--session-id', 'private-session', '--device-id', 'private-device', '--before-hash', 'a'.repeat(64),
      '--after-hash', 'b'.repeat(64), '--correlation-id', 'private-correlation', '--idempotency-key', 'private-key'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NODE_ENV: 'test', BACKEND_RUNTIME_ROLE: 'standalone', RECOVERY_COORDINATION_DIR: root,
        DATABASE_URL: 'postgresql://unreachable:private@127.0.0.1:1/must_not_connect?connection_limit=1&pool_timeout=1',
        BACKEND_CONTROL_LOCK_FD: '', BACKEND_CONTROL_LOCK_FILE: '' },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /RUNTIME_CONTROL_OWNERSHIP_REQUIRED/);
    assert.doesNotMatch(result.stderr, /PrismaClientInitializationError|Can't reach database|P1001/);
    assert.deepEqual(readFileSync(registration), original);
    assert.equal(existsSync(path.join(root, 'storage')), false);
  } finally {
    unlinkSync(registration); rmdirSync(native); rmdirSync(online); rmdirSync(root);
  }
});
