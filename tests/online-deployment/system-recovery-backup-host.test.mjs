import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sh = process.platform === 'win32'
  ? path.resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim(), '../../../usr/bin/sh.exe')
  : '/bin/sh';
const runner = fileURLToPath(new URL('../../deploy/scripts/deploy.sh', import.meta.url)).split(path.sep).join('/');
const runShell = (args, options) => spawnSync(sh, ['-c', 'PATH=/usr/bin:$PATH; export PATH; exec sh "$@"', 'sh', ...args], options);
const operationId = 'c' + 'a'.repeat(24);

test('the protected backup CLI refuses invalid secret input before reading host state', () => {
  for (const input of [Buffer.from('short1'), Buffer.alloc(4097, 'a'), Buffer.from([0xff])]) {
    const result = runShell([runner, '--system-recovery-backup', 'missing.env', operationId], {
      input, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.trim(), 'SYSTEM_RECOVERY_BACKUP_INPUT_INVALID');
    assert.equal(result.stdout, '');
  }
});

const backupRunner = fileURLToPath(new URL('../../deploy/scripts/system-recovery-backup-host.sh', import.meta.url))
  .split(path.sep).join('/');
const fixture = String.raw`set -eu
. "$1"
BACKUP_FIXTURE_FAILURE="$2"
REPO_ROOT=/opt/sabalanerp
OPERATIONS_ROOT=/fake
COMPOSE_FILE=docker-compose.prod.yml
ENV_FILE=/fake/env
SESSION_HOST_PATH=/fake/session
CONFIGURATION_STATE=/fake/config
SYSTEM_RECOVERY_BACKUP_HOST=/fake/system-recovery-backup-host.mjs
SYSTEM_RECOVERY_BACKUP_INTENT=/fake/hold
SYSTEM_RECOVERY_OPERATION_ID=caaaaaaaaaaaaaaaaaaaaaaaa
DEPLOYMENT_OWNER=operator
MAINTENANCE_ACTIVE=0
ADVISORY_PID=""
PREDECESSOR_DATABASE_MODE=split:original
if [ "$BACKUP_FIXTURE_FAILURE" = legacy ]; then PREDECESSOR_DATABASE_MODE=legacy; fi
exec 8<&0 </dev/null
id() { printf '0\n'; }
realpath() { printf '%s\n' "$2"; }
compose() { printf 'container-id\n'; }
docker() { printf '[]\n'; }
predecessor_database_topology() {
  [ "$*" = retained ]
  if [ "$BACKUP_FIXTURE_FAILURE" = role-drift ]; then printf 'split:changed\n'; else printf 'split:original\n'; fi
}
capture_only_services() {
  if [ "$BACKUP_FIXTURE_FAILURE" = scanner-missing ]; then printf 'five-services\n'; else printf 'six-original-services\n'; fi
}
node() {
  case "$*" in
    *deployment-existing-release.mjs)
      read -r inspection && [ "$inspection" = six-original-services ] || return 1
      printf '%s\n' 'DEPLOYMENT_BACKEND_IMAGE=backend DEPLOYMENT_FRONTEND_IMAGE=frontend DEPLOYMENT_INQUIRY_IMAGE=inquiry DEPLOYMENT_NGINX_IMAGE=nginx DEPLOYMENT_POSTGRES_IMAGE=postgres DEPLOYMENT_CLAMAV_IMAGE=clamav DEPLOYMENT_TARGET_COMMIT=commit'
      ;;
    *performance-deployment-environment.mjs*) printf 'release\n' ;;
    *'start-original'*) [ "$DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE" = clamav ]; echo 'start-original-six-services' ;;
    *' hold '*) echo 'persist-hold' ;;
    *' clear '*) echo 'complete-intent' ;;
    *'randomBytes'*) printf 'unique\n' ;;
    *'hrtime'*) printf '0\n' ;;
  esac
}
python3() { echo 'drain-preflight'; }
run_backend() {
  case "$*" in
    *"system-recovery-owner.js "*)
      IFS= read -r supplied || [ -n "$supplied" ]
      [ "$supplied" = 'synthetic1passphrase' ]
      echo 'owner'
      [ "$BACKUP_FIXTURE_FAILURE" != owner ]
      ;;
    *deployment-gates.js*)
      [ "$DEPLOYMENT_GATE_MODE" = PREVIOUS_UNCHANGED ]
      echo 'gates'
      [ "$BACKUP_FIXTURE_FAILURE" != gates ]
      ;;
  esac
}
try_acquire_advisory() { echo 'advisory'; }
assert_system_recovery_advisory() { echo 'advisory-verified'; }
control() { echo "control $*"; }
session_value() { printf 'lease-token\n'; }
phase() { echo "phase $*"; }
verify_public_maintenance() { echo 'public-503'; }
drain_current_services() { echo 'drain'; }
assert_original_legacy_still_stopped() { echo 'original-drained'; }
assert_native_runtime_closed() { echo 'native-closed'; }
verify_predecessor_database_roles() { echo 'roles-verified'; }
run_original_owned_with_heartbeat() { "$@"; }
cleanup_locks() { echo 'cleanup'; }
sleep() { :; }
run_system_recovery_backup
`;

function runBackupFixture(failure = '') {
  const result = runShell(['-c', fixture, 'sh', backupRunner, failure], {
    input: 'synthetic1passphrase', encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic1passphrase/);
  return result;
}

test('the protected backup opens traffic after the owner and unchanged release gates pass', () => {
  const result = runBackupFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /roles-verified[\s\S]*persist-hold[\s\S]*control acquire[\s\S]*public-503[\s\S]*drain\n[\s\S]*phase SERVICES_DRAINED[\s\S]*owner\n[\s\S]*native-closed[\s\S]*start-original-six-services[\s\S]*roles-verified[\s\S]*gates[\s\S]*public-503[\s\S]*control maintenance-off[\s\S]*control finish[\s\S]*complete-intent/);
});

test('the predecessor requires the scanner and a prepared split and holds on drained database binding drift', () => {
  for (const failure of ['scanner-missing', 'legacy']) {
    const result = runBackupFixture(failure);
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /persist-hold|control maintenance-on|owner\n/);
  }
  const drift = runBackupFixture('role-drift');
  assert.equal(drift.status, 1, drift.stderr);
  assert.doesNotMatch(drift.stdout, /owner\n|maintenance-off|complete-intent/);
  assert.match(drift.stderr, /held in maintenance/);
});

test('owner or unchanged release gate failures keep the durable hold and maintenance', () => {
  for (const failure of ['owner', 'gates']) {
    const result = runBackupFixture(failure);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /persist-hold[\s\S]*control maintenance-on[\s\S]*owner[\s\S]*control maintenance-on[\s\S]*cleanup/);
    assert.doesNotMatch(result.stdout, /maintenance-off|complete-intent/);
    assert.match(result.stderr, /held in maintenance/);
  }
});
