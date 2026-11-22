import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the Linux host CLI requires the actual inherited ownership lock and records capacity', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-storage-cli-'));
  try {
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\ncase "$*" in "ps -aq"|"image ls -q --no-trunc") exit 0;; *) exit 99;; esac\n', { mode: 0o700 });
    const cli = fileURLToPath(new URL('../../deploy/scripts/storage-preflight.mjs', import.meta.url));
    const script = path.join(root, 'run.sh');
    fs.writeFileSync(script, 'set -eu\nexec 9>"$TEST_ROOT/lock"\nflock -n 9\nnode "$TEST_CLI" --mode apply --project sabalanerp --lock-file "$TEST_LOCK" --lock-fd 9 --storage-root "$TEST_ROOT" --required-bytes 1 --checkpoint-root "$TEST_ROOT/checkpoints" --audit "$TEST_ROOT/audit.jsonl"\n');
    fs.mkdirSync(path.join(root, 'checkpoints'));
    fs.writeFileSync(path.join(root, 'wrong-lock'), '');
    const invoke = lock => spawnSync('/bin/sh', [script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, TEST_CLI: cli, TEST_LOCK: lock } });
    const rejected = invoke(path.join(root, 'wrong-lock'));
    assert.notEqual(rejected.status, 0);
    assert.equal(fs.existsSync(path.join(root, 'audit.jsonl')), false);
    const accepted = invoke(path.join(root, 'lock'));
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'audit.jsonl'), 'utf8')).event, 'CAPACITY_CHECK');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
