import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = fs.readFileSync(path.resolve(process.cwd(), '../deploy/scripts/deploy.sh'), 'utf8');
assert.doesNotMatch(script, /\bdocker\b[^\n]*\bprune\b/,
  'deployment must never run a global Docker prune');
const preStart = script.indexOf('docker_root="$(docker info');
const preEnd = script.indexOf('\nDEPLOYMENT_BACKEND_IMAGE=', preStart);
const buildStart = script.indexOf('for release_service in backend frontend inquiry; do');
const buildEnd = script.indexOf('\ndone', buildStart) + '\ndone'.length;
const postStart = script.indexOf('# Re-measure actual capacity');
const postEnd = script.indexOf('DEPLOYMENT_TARGET_BACKEND_IMAGE=', postStart);
const maintenance = script.indexOf('\ncontrol prepare\n');
const preflight = script.indexOf('sh "${OPERATIONS_ROOT}/deploy/scripts/storage-preflight.sh" "${ENV_FILE}" "${REPO_ROOT}" "${OPERATIONS_ROOT}" "${docker_required_bytes}" 0');
assert.ok(preflight > 0 && preflight < preStart);
assert.ok(preStart > 0 && preStart < preEnd && preEnd < buildStart);
assert.ok(buildStart < buildEnd && buildEnd < postStart && postStart < postEnd && postEnd < maintenance);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-build-capacity-'));
try {
  for (const [failure, initialKb, finalKb, expectedStatus, expectedEvents] of [
    ['', 2048, 2048, 0, ['MEASURE', 'BUILD-backend', 'BUILD-frontend', 'BUILD-inquiry', 'MEASURE', 'READY']],
    ['build-frontend', 2048, 2048, 9, ['MEASURE', 'BUILD-backend', 'BUILD-frontend']],
    ['', 100, 2048, 1, ['MEASURE']],
    ['', 2048, 100, 1, ['MEASURE', 'BUILD-backend', 'BUILD-frontend', 'BUILD-inquiry', 'MEASURE']],
  ] as const) {
    const result = spawnSync(bash, ['-c', `
set -eu
docker_required_bytes=1048576
compose() {
  [ "$1" = build ] || exit 99
  echo "BUILD-$2" >> events
  [ "build-$2" != '${failure}' ] || return 9
}
docker() {
  case " $* " in *' prune '*) echo FORBIDDEN-PRUNE >> events; exit 98;; esac
  [ "$*" = 'info --format {{.DockerRootDir}}' ] || exit 99
  echo /mock-docker
}
df() {
  echo MEASURE >> events
  available=${initialKb}
  [ ! -f measured ] || available=${finalKb}
  : > measured
  printf 'Filesystem Blocks Used Available Capacity Mounted\\nmock 0 0 %s 0 /\\n' "$available"
}
: > events
rm -f measured
${script.slice(preStart, preEnd)}
${script.slice(buildStart, buildEnd)}
${script.slice(postStart, postEnd)}
echo READY >> events
`], { cwd: directory, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'events'), 'utf8').trim().split('\n'), expectedEvents);
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log('deployment build capacity tests passed');
