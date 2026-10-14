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
      initializeRecovery: async () => { await fs.writeFile(marker, 'RESET'); },
      verifyCutover: async () => { throw new Error('candidate attempted activation'); },
      startWorkers: () => { throw new Error('candidate attempted delivery'); },
      listen: () => { listening = true; },
    });
    assert.equal(listening, true);
    assert.equal(await fs.readFile(marker, 'utf8'), 'RECOVERY_IN_PROGRESS');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
