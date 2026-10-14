import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readTerminalDeployments } from '../../scripts/deployment-storage.mjs';

test('only intact finalized successful or recovered operation journals authorize stopped-container cleanup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-terminal-'));
  try {
    const write = async (id, phase, event = 'deployment-finished') => {
      const entry = { sequence: 1, at: '2026-10-14T00:00:00Z', deploymentId: id, phase, event, previousHash: null };
      const hash = createHash('sha256').update(JSON.stringify(entry)).digest('hex');
      await fs.writeFile(path.join(root, `${id}.journal.jsonl`), `${JSON.stringify({ ...entry, hash })}\n`);
    };
    await write('deploy-complete', 'COMPLETED');
    await write('deploy-rollback', 'ROLLED_BACK');
    await write('deploy-incident', 'RECOVERY_REQUIRED');
    await write('deploy-running', 'MUTATION_STARTED', 'phase-transition');
    assert.deepEqual([...await readTerminalDeployments([root])].sort(), ['deploy-complete', 'deploy-rollback']);
    const file = path.join(root, 'deploy-complete.journal.jsonl');
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('COMPLETED', 'ABORTED'));
    await assert.rejects(readTerminalDeployments([root]), /JOURNAL_INVALID/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
