import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync(new URL('../../deploy/scripts/deploy.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const extract = name => {
  const start = source.indexOf(`${name}() {`);
  assert(start >= 0, `${name} is missing`);
  const end = source.indexOf('\n}\n', start);
  assert(end > start, `${name} is incomplete`);
  return source.slice(start, end + 3);
};
const shell = process.platform === 'win32'
  ? path.resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), '../../../usr/bin/sh.exe')
  : '/bin/sh';

function run({ capture, incident = false, secondStatus = 503 }) {
  const script = [
    'set -eu',
    `CAPTURE_ONLY=${capture}; DEPLOYMENT_CLAMAV_OPERATION=${incident ? 'incident-recovery' : 'repair'}; MAINTENANCE_ACTIVE=0`,
    'env_value(){ case "$1" in DOMAIN) echo erp.example;; INQUIRY_DOMAIN) echo inquiry.example;; esac; }',
    `curl(){ printf 'PROBE:%s\n' "$*" >&2; case "$*" in *inquiry.example*) echo ${secondStatus};; *erp.example*) echo 503;; *) return 91;; esac; }`,
    'control(){ echo CONTROL:$1; }',
    'compose(){ echo COMPOSE:$*; }',
    extract('verify_public_maintenance'),
    extract('enter_maintenance'),
    'set +e',
    'enter_maintenance',
    'result=$?',
    'echo RESULT:$result:MARKER:$MAINTENANCE_ACTIVE',
    '[ "$result" -ne 0 ] || echo DRAIN_ALLOWED',
  ].join('\n');
  const result = spawnSync(shell, ['-c', script], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /PROBE:.*erp\.example/);
  assert.match(result.stderr, /PROBE:.*inquiry\.example/);
  return result.stdout;
}

test('capture maintenance preserves original Nginx while both origins return 503', () => {
  const output = run({ capture: 1 });
  assert.match(output, /CONTROL:maintenance-on/);
  assert.doesNotMatch(output, /COMPOSE:/);
  assert.match(output, /RESULT:0:MARKER:1/);
  assert.match(output, /DRAIN_ALLOWED/);
});

test('capture maintenance refuses drain if either public origin is not 503', () => {
  const output = run({ capture: 1, secondStatus: 200 });
  assert.match(output, /CONTROL:maintenance-on/);
  assert.doesNotMatch(output, /COMPOSE:|DRAIN_ALLOWED|maintenance-off/);
  assert.match(output, /RESULT:1:MARKER:1/);
});

test('unproven capture maintenance keeps the marker and refuses recovery reopening', () => {
  const recoveryStart = source.indexOf('recover_failure() {');
  const recoveryEnd = source.indexOf('  if [ "${ROLLBACK_ALREADY_ATTEMPTED}" -eq 1 ]; then', recoveryStart);
  assert(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const script = [
    'set -eu',
    'CAPTURE_ONLY=1; CAPTURE_MAINTENANCE_PROVEN=0; MAINTENANCE_ACTIVE=1; SESSION_PREPARED=1',
    'PUBLIC_TRAFFIC_OPEN=0; LEGACY_BACKEND_SIGNAL_PENDING=0; ROLLBACK_ALREADY_ATTEMPTED=0',
    'MUTATION_STARTED=0; DB_LEASE_ACQUIRED=1; DEPLOYMENT_CLAMAV_OPERATION=repair',
    'control(){ echo CONTROL:$1; }',
    'cleanup_locks(){ echo LOCKS; }',
    source.slice(recoveryStart, recoveryEnd) + '\n}',
    'recover_failure 71',
    'echo UNSAFE_REOPEN',
  ].join('\n');
  const result = spawnSync(shell, ['-c', script], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 71, result.stderr);
  assert.match(result.stdout, /CONTROL:maintenance-on/);
  assert.doesNotMatch(result.stdout, /maintenance-off|UNSAFE_REOPEN|COMPOSE:/);
  assert.match(result.stderr, /maintenance boundary was not proven/i);
});

test('ordinary and incident maintenance keep their existing Nginx transition', () => {
  const ordinary = run({ capture: 0 });
  assert.match(ordinary, /COMPOSE:up -d --no-deps --force-recreate nginx\nCONTROL:maintenance-on/);
  const incident = run({ capture: 0, incident: true });
  assert.match(incident, /CONTROL:maintenance-on\nCOMPOSE:up -d --no-deps --force-recreate nginx/);
});
