import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedBridgeMigration, protectedBridgeMigrationNames } from '../protectedBridgeMigrations';

const pending = [
  ['20261014140000_online_deployment_control', 29],
  ['20261019010000_customer_semantic_barrier', 1],
  ['20261019020000_hr_versioned_file_cleanup', 1],
  ['20261020010000_online_realtime_completion', 10],
  ['20261020093000_online_serving_epochs', 5],
] as const;
// Git's canonical Linux deployment bytes are LF. Windows checkout conversion
// is confined to this source fixture; the compiler itself accepts exact bytes.
const source = (name: string) => Buffer.from(fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n'));

test('the actual five pending files compile to bounded executable statements without expanding bootstrap authority', () => {
  assert.deepEqual(protectedBridgeMigrationNames, [
    '20261014120000_hr_vehicle_assignment_plans', '20261014140000_online_deployment_control',
  ]);
  for (const [name, count] of pending) {
    const compiled = compileProtectedBridgeMigration(name, source(name));
    assert.equal(compiled.statements.length, count, name);
  }
  const barrier = source(pending[1][0]).toString();
  assert.equal(compileProtectedBridgeMigration(pending[1][0], Buffer.from(barrier)).statements[0], barrier);
});

test('none of the five exact strategies grants authority to changed, truncated, appended or Windows-converted SQL', () => {
  for (const [name] of pending) {
    const bytes = source(name), changed = Buffer.from(bytes);
    changed[Math.floor(changed.length / 2)] ^= 1;
    for (const invalid of [changed, bytes.subarray(0, bytes.length - 1), Buffer.concat([bytes, Buffer.from('\nSELECT 1;')]),
      Buffer.from(bytes.toString().replace(/\n/g, '\r\n'))]) {
      assert.throws(() => compileProtectedBridgeMigration(name, invalid), /SQL_IDENTITY_MISMATCH/);
    }
  }
});
