import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {openSync, closeSync, fstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {BrowserRoutingPublicationLock} from '../../deploy/scripts/browser-routing-store.mjs';
import {assertPrivateUiStartup} from './private-ui-startup.fixture.mjs';

function lock(file, descriptor) {
  const stat = fstatSync(descriptor, {bigint: true});
  return new BrowserRoutingPublicationLock({file, descriptor,
    identity: {device: stat.dev.toString(), inode: stat.ino.toString(), ownerUid: process.getuid()}});
}
const acquire = descriptor => spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'],
  {stdio: ['ignore', 'ignore', 'ignore', descriptor]}).status;
for (const marker of ['transport-shutdown-held.json', 'obsolete-proxy-retirement-held.json']) {
  test('native restart refuses retained ' + marker + ' including publication between precheck and lock acquisition', async () => {
    assert.equal(process.platform, 'linux');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-private-ui-startup-'));
    const file = path.join(root, 'publication.lock');
    let first = openSync(file, 'wx+', 0o600), replacement = openSync(file, 'r+');
    try {
      assert.equal(acquire(first), 0);
      await assertPrivateUiStartup(root, lock(file, first));
      assert.equal(acquire(replacement), 1, 'A prechecked replacement cannot acquire the active owner');
      assert.throws(() => lock(file, replacement), /NATIVE_LOCK_UNPROVEN/);
      await assert.rejects(() => assertPrivateUiStartup(root, {assertOwned() {}}), /NATIVE_STARTUP_LOCK_REQUIRED/);
      const held = await fs.open(path.join(root, marker), 'wx', 0o600);
      try {await held.writeFile('retained-unknown\n'); await held.sync();} finally {await held.close();}
      const directory = await fs.open(root, 'r'); try {await directory.sync();} finally {await directory.close();}
      closeSync(first); first = undefined;
      assert.equal(acquire(replacement), 0);
      await assert.rejects(() => assertPrivateUiStartup(root, lock(file, replacement)), /HELD_TRANSPORT_REQUIRES_INSPECTION/);
      assert.equal(await fs.readFile(path.join(root, marker), 'utf8'), 'retained-unknown\n');
    } finally {
      if (first !== undefined) closeSync(first); if (replacement !== undefined) closeSync(replacement);
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('sabalan-private-ui-startup-')); await fs.rm(root, {recursive: true, force: true});
    }
  });
}
