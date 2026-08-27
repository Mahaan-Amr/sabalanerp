import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

test('read-only Partner audit reports stable legacy counts and hashes without returning business data', () => {
  const root = path.resolve(__dirname, '../../../..');
  const run = () => JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'backend/node_modules/tsx/dist/cli.mjs'),
    path.join(root, 'backend/scripts/partner-schema-audit.ts'), '--local',
  ], { cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true }));
  const before = run();
  const after = run();
  assert.equal(before.interfaceVersion, 'partner-schema/v1');
  assert.deepEqual(before.legacy, after.legacy);
  assert.ok(before.legacy.sales_contracts);
  for (const fingerprint of Object.values(before.legacy) as any[]) {
    assert.equal(typeof fingerprint.count, 'number');
    assert.match(fingerprint.hash, /^md5-rowset-v1:[a-f0-9]{32}$/);
    assert.deepEqual(Object.keys(fingerprint).sort(), ['count', 'hash']);
  }
  assert.equal(before.activationOpen, false);
});
