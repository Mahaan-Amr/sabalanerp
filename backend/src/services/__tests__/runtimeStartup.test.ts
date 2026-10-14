import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startRuntime } from '../runtimeStartup';

test('a candidate can start its probe listener without touching live recovery or starting deliveries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-candidate-'));
  const marker = path.join(root, 'recovery.json');
  try {
    await fs.writeFile(marker, 'RECOVERY_IN_PROGRESS');
    let listening = false;
    await startRuntime('candidate', {
      assertControlOwnership: () => { throw new Error('candidate attempted control ownership'); },
      initializeRecovery: async () => { await fs.writeFile(marker, 'RESET'); },
      verifyCutover: async () => { throw new Error('candidate attempted activation'); },
      startWorkers: () => { throw new Error('candidate attempted delivery'); },
      listen: () => { listening = true; },
    });
    assert.equal(listening, true);
    assert.equal(await fs.readFile(marker, 'utf8'), 'RECOVERY_IN_PROGRESS');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
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
