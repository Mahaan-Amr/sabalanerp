import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ensureRecoveryOwnerPublicKey } from '../../deploy/scripts/system-recovery-owner-host.mjs';

test('public key publication overrides restrictive umask and repairs only a verified matching file', () => {
  let exists = false, content = '', mode = 0o400, uid = 0, nlink = 1;
  const io = {
    openSync(_file, flags) {
      if (flags === 'wx' && exists) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      exists = true; return 7;
    },
    writeFileSync(_fd, value) { content = value; },
    fstatSync() { return { isFile: () => true, uid, nlink, mode, size: content.length, dev: 1, ino: 2 }; },
    lstatSync() { return { isFile: () => true, isSymbolicLink: () => false, uid, nlink, mode, dev: 1, ino: 2 }; },
    realpathSync: value => value,
    readFileSync: () => content,
    fchmodSync(_fd, value) { mode = value; }, fsyncSync() {}, closeSync() {},
  };
  ensureRecoveryOwnerPublicKey('/keys/public.pem', 'derived-public-key', io);
  assert.equal(mode, 0o444);
  mode = 0o400;
  ensureRecoveryOwnerPublicKey('/keys/public.pem', 'derived-public-key', io);
  assert.equal(mode, 0o444);
  for (const invalid of ['content', 'uid', 'nlink']) {
    mode = 0o400; content = invalid === 'content' ? 'foreign-key' : 'derived-public-key';
    uid = invalid === 'uid' ? 1000 : 0; nlink = invalid === 'nlink' ? 2 : 1;
    assert.throws(() => ensureRecoveryOwnerPublicKey('/keys/public.pem', 'derived-public-key', io));
    assert.equal(mode, 0o400);
  }
});

test('native root provisioning under umask077 repairs public readability and preserves private bytes',
  { skip: process.platform !== 'linux' || process.getuid?.() !== 0 }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-owner-key-'));
    const script = fileURLToPath(new URL('../../deploy/scripts/system-recovery-owner-host.mjs', import.meta.url));
    const run = () => {
      const result = spawnSync('/bin/sh', ['-c', 'umask 077; exec "$1" "$2" provision "$3"', 'sh', process.execPath, script, directory], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    try {
      run();
      const publicFile = path.join(directory, 'system-recovery-owner-public.pem');
      const privateFile = path.join(directory, 'system-recovery-owner-private.pem');
      const digest = () => createHash('sha256').update(fs.readFileSync(privateFile)).digest('hex');
      const before = digest();
      assert.equal(fs.statSync(publicFile).mode & 0o777, 0o444);
      fs.chmodSync(publicFile, 0o400);
      run();
      assert.equal(fs.statSync(publicFile).mode & 0o777, 0o444);
      assert.equal(fs.statSync(privateFile).mode & 0o777, 0o400);
      assert.equal(digest(), before);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
