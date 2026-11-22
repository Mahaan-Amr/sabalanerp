import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startRuntime } from '../runtimeStartup';

test('protected application startup runs recovery and workers before listening', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-candidate-'));
  const marker = path.join(root, 'recovery.json');
  try {
    await fs.writeFile(marker, 'RECOVERY_IN_PROGRESS');
    const effects: string[] = [];
    await startRuntime('standalone', {
      assertControlOwnership: () => { effects.push('ownership'); },
      initializeRecovery: async () => { effects.push('recovery'); await fs.writeFile(marker, 'RESET'); },
      verifyCutover: async () => { effects.push('cutover'); },
      startWorkers: () => { effects.push('workers'); },
      listen: () => { effects.push('listen'); },
    });
    assert.deepEqual(effects, ['ownership', 'recovery', 'cutover', 'workers', 'listen']);
    assert.equal(await fs.readFile(marker, 'utf8'), 'RESET');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('an online candidate role cannot bypass protected startup', async () => {
  const { resolveRuntimeRole } = await import('../runtimeStartup');
  assert.throws(() => resolveRuntimeRole('candidate'), /BACKEND_RUNTIME_ROLE_INVALID/);
});

test('an unfenced owner cannot initialize recovery, activate workers or listen', async () => {
  const effects: string[] = [];
  await assert.rejects(startRuntime('standalone', {
    assertControlOwnership: () => { throw new Error('OWNERSHIP_UNAVAILABLE'); },
    initializeRecovery: async () => { effects.push('recovery'); },
    verifyCutover: async () => { effects.push('cutover'); },
    startWorkers: () => { effects.push('workers'); },
    listen: () => { effects.push('listen'); },
  }), /OWNERSHIP_UNAVAILABLE/);
  assert.deepEqual(effects, []);
});
