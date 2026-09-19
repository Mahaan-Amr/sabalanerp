import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = fs.readFileSync(path.resolve(process.cwd(), '../deploy/scripts/deploy.sh'), 'utf8');
const start = script.indexOf('# Reclaim disposable build records');
const end = script.indexOf('DEPLOYMENT_TARGET_BACKEND_IMAGE=', start);
assert.ok(start > script.indexOf('compose build "${release_service}"'));
assert.ok(end < script.indexOf('\ncontrol prepare\n'));
const block = script.slice(start, end);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-build-capacity-'));
fs.mkdirSync(path.join(directory, '.deploy-state'));
try {
  for (const [availableKb, pruneExit, expectedStatus, expectedPrune] of [
    [100, 0, 0, true],
    [2048, 0, 0, false],
    [100, 7, 7, true],
  ] as const) {
    const result = spawnSync(bash, ['-c', `
set -eu
REPO_ROOT=.
docker_root=/mock-docker
docker_required_bytes=1048576
df() { printf 'Filesystem Blocks Used Available Capacity Mounted\\nmock 0 0 ${availableKb} 0 /\\n'; }
docker() {
  [ "$*" = 'builder prune --all --force' ] || exit 99
  echo PRUNE >&2
  return ${pruneExit}
}
${block}
echo READY
`], { cwd: directory, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(result.stderr.includes('PRUNE'), expectedPrune);
    assert.equal(result.stdout.includes('READY'), expectedStatus === 0,
      'a cache-cleanup error must abort before maintenance');
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log('deployment build capacity tests passed');
