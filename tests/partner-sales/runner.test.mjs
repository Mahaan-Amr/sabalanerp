import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('runner rejects unknown commands and Playwright overrides before any runtime action', () => {
  for (const args of [['production'], ['browser', '--config=unsafe.ts'], ['cleanup', 'admin']]) {
    const result = spawnSync(process.execPath, ['scripts/run-partner-sales-tests.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Partner QA usage/);
    assert.doesNotMatch(result.stdout, /Running|fixture/);
  }
});
